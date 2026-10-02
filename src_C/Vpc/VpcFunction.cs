using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda;

public sealed class VpcFunction
{
  // One spelling of this function's name, used both as the `lambda` field of the structured
  // logs and as the Service dimension of the metrics. They have to be the same string for
  // anyone to join an alarm to the log lines behind it, and two literals cannot promise that.
  private const string ServiceName = "core-vpc";

  public VpcFunction()
  {
    // SnapStart runtime hooks must be registered during init (before snapshot).
    // Note these never fire while SnapStart is off on this function, which is why the
    // warmup below hangs off the constructor rather than off a restore hook.
    SnapStartHooks.RegisterOnce();

    // Read the bearer-verification policy here, in INIT, so that if the unverified dev mode
    // is on the warning is the first thing in the log stream rather than a line buried after
    // the first request. Never throws: a bad AUTH_ISSUERS value would, so it is caught and
    // logged, and the first request then fails closed with a 401 instead of a crashed INIT.
    try { Auth.EnsureConfigured(); } catch (Exception ex) { Log.Error("auth config:", ex.Message); }

    // Boot line once per container, not once per request: the constructor is the INIT-phase
    // mount point, so this fires on cold start and the CloudWatch count tracks cold starts.
    // No path/method here — a container serves many requests, so per-request fields belong on
    // the per-request line in DispatchAsync.
    Log.Event("info", new
    {
      tag = "boot",
      lambda = ServiceName,
      version = Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_VERSION"),
      apiEnv = Environment.GetEnvironmentVariable("API_ENV"),
      allowDevPremium = Environment.GetEnvironmentVariable("ALLOW_DEV_PREMIUM"),
      disallowSandbox = Environment.GetEnvironmentVariable("DISALLOW_SANDBOX_PREMIUM"),
    });

    // The constructor is the real INIT phase mount point: it runs once per container,
    // before any request, with the init phase CPU burst. RunOnce never throws.
    Warmup.RunOnce();
  }

  public async Task<APIGatewayProxyResponse> Handler(JsonElement evt)
  {
    var req = new LambdaRequest(evt);
    // The origin travels with the response builder, not with a route: every response this
    // function can produce -- including the OPTIONS preflight and the 500 from the catch
    // below -- has to carry the same CORS answer, or the browser reports the wrong failure.
    var res = new Res(req.TraceId, req.Origin);

    // The whole dispatch, wrapped once. Deliberately the only statement in this method that
    // can produce a response: there is no early return above it and no route below it, so a
    // route added tomorrow is measured without anyone deciding to measure it. That is the
    // entire difference between this and a Stopwatch inside each handler, and it is why the
    // 404 branch and the unhandled-exception branch -- the two that matter most and get
    // instrumented last -- are covered here for free.
    return await RouteMetrics.MeasureAsync(ServiceName, req, () => DispatchAsync(req, res));
  }

  private static AuthContext Anonymous() => new(
    Claims: new Dictionary<string, JsonElement>(StringComparer.Ordinal),
    UserSub: null,
    Username: null,
    Groups: [],
    IsSuperAdmin: false,
    IsEditor: false,
    IsAdmin: false);

  private static async Task<APIGatewayProxyResponse> DispatchAsync(LambdaRequest req, Res res)
  {
    // R24 A01: the anonymous funnel ingest never resolves a bearer, so a signed-in caller is never linked to (or logged
    // with) the events it sends. Matched exactly, like the internal routes below.
    var publicEvents = RouteMatcher.Match("/api/v1/public/events", req.Path.TrimEnd('/')) is not null;
    AuthContext auth;
    try
    {
      auth = publicEvents ? Anonymous() : await Auth.GetAuthContextAsync(req);
    }
    catch
    {
      auth = Anonymous();
    }

    if (string.Equals(req.Method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
    {
      return res.Raw(200, new { ok = true });
    }

    Log.Event("info", new
    {
      traceId = req.TraceId,
      lambda = ServiceName,
      method = req.Method,
      path = req.Path,
      userSub = auth.UserSub,
      username = auth.Username,
      groups = auth.Groups,
      isAdmin = auth.IsAdmin,
      isSuperAdmin = auth.IsSuperAdmin,
    });

    try
    {
      if ((req.RawBody?.Length ?? 0) > 1_048_576) return res.PayloadTooLarge();
      // 💡 彻底清除路径匹配的干扰因素：去掉尾部斜杠
      var p = req.Path.TrimEnd('/');

      var agentDeny = Vpc.AgentClientPolicy.Deny(auth, req, p, res);
      if (agentDeny is not null) return agentDeny;

      if (p.EndsWith("/health", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.Ok(new { ok = true });

      // R24 A01 (contract R24-00 §3.2): public, no auth, exact path; the handler takes no AuthContext.
      if (publicEvents)
      {
        return await Vpc.Analytics.AnonFunnel.HandleEvents(req, res);
      }

      // RevenueCat webhooks
      if (
        (p.EndsWith("/webhooks/revenuecat/development", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/webhooks/revenuecat/production", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/rc/webhook", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/webhooks/revenuecat", StringComparison.OrdinalIgnoreCase)) &&
        req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Webhooks.RevenuecatWebhook.HandleRevenuecatWebhook(req, res);
      }

      // DB
      if (p.EndsWith("/api/v1/db/ping", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbPing(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/migrate", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbMigrate(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/bootstrap-roles", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.AppRole.HandleBootstrapRoles(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/content-intelligence-demo", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.ContentIntelligenceDemo.HandleContentIntelligenceDemo(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/migrations", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbMigrationsList(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/create", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbCreateDatabase(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/databases", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbListDatabases(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/recreate", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Migrate.HandleDbDropAndRecreate(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/netcheck", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.Netcheck.HandleDbNetcheck(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/premium-state", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.QueryPremiumState.HandleDbPremiumState(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/db/rc-events", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Db.QueryRcEvents.HandleDbRcEvents(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/analytics/outbox/publish", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Analytics.OutboxPublisher.HandlePublishOutbox(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/analytics/content-intelligence/import", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Analytics.ContentIntelligenceSnapshotImport.HandleImportSnapshot(req, res, auth);
      }

      // Authoring
      if (p.EndsWith("/api/v1/authoring/decks", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Decks.HandleAuthoringDecks(req, res, auth);
      }
      // Keyset-paginated card list. Additive: the unpaged route below keeps its
      // exact behaviour for the console and the mobile app. Ordering matters
      // less than it looks — "/api/v1/authoring/cards/page" does not end with
      // "/api/v1/authoring/cards", so the two never shadow each other — but the
      // more specific path stays first anyway, so a future prefix match cannot
      // quietly swallow it.
      if (p.EndsWith("/api/v1/authoring/cards/import", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.CardsImport.HandleCardsImport(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/cards/page", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.CardsPage.HandleAuthoringCardsPage(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/cards", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Cards.HandleAuthoringCards(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/permissions", StringComparison.OrdinalIgnoreCase) || p.EndsWith("/api/v1/admin/permissions/bulk", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Permissions.HandleAuthoringPermissions(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/publish", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.Publish.HandleAuthoringPublish(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/publish/status", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.PublishStatus.HandlePublishStatus(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/publish/jobs", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.PublishJobs.HandleFetchPublishJobs(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/content-intelligence", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.ContentIntelligence.HandleContentIntelligence(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/manifest/rebuild", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.ManifestRebuild.HandleManifestRebuild(req, res, auth);
      }
      if (p.EndsWith("/rollback", StringComparison.OrdinalIgnoreCase) && p.Contains("/api/v1/admin/decks/", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.DeckRollback.HandleDeckRollback(req, res, auth);
      }
      if (p.EndsWith("/builds", StringComparison.OrdinalIgnoreCase) && p.Contains("/api/v1/admin/decks/", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.DeckBuilds.HandleDeckBuilds(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/publish/reap", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.PublishReaper.HandlePublishReap(req, res, auth);
      }
      // R18 — console/admin routes (contract §2: later issues append below)
      if (p.EndsWith("/api/v1/admin/webhooks/subscriptions", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Integrations.WebhookSubscriptions.HandleSubscriptions(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/webhooks/subscriptions/:subscriptionId/test", p) is { } webhookTest)
      {
        return await Vpc.Integrations.WebhookSubscriptions.HandleTest(req, res, auth, webhookTest["subscriptionId"]);
      }
      if (RouteMatcher.Match("/api/v1/admin/webhooks/subscriptions/:subscriptionId", p) is { } webhookSubscription)
      {
        return await Vpc.Integrations.WebhookSubscriptions.HandleSubscription(req, res, auth, webhookSubscription["subscriptionId"]);
      }
      if (p.EndsWith("/api/v1/admin/webhooks/deliveries", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Integrations.WebhookDeliveries.HandleDeliveries(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/webhooks/deliveries/sweep", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Integrations.WebhookDeliveries.HandleSweep(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/webhooks/deliveries/:deliveryId/redeliver", p) is { } webhookRedeliver)
      {
        return await Vpc.Integrations.WebhookDeliveries.HandleRedeliver(req, res, auth, webhookRedeliver["deliveryId"]);
      }
      if (p.EndsWith("/api/v1/admin/automation/ledger", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Ledger.LedgerRoutes.HandleLedger(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/automation/events", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Ledger.LedgerRoutes.HandleEvents(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/automation/baselines", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Ledger.LedgerRoutes.HandleBaselines(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/automation/baselines/:automation", p) is { } ledgerBaseline)
      {
        return await Vpc.Ledger.LedgerRoutes.HandleBaseline(req, res, auth, ledgerBaseline["automation"]);
      }
      if (p.EndsWith("/api/v1/admin/automation/backfill", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Ledger.LedgerRoutes.HandleBackfill(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/cards/similar", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.CardSimilarity.HandleSimilar(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/drafts", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Review.Drafts.HandleDrafts(req, res, auth);
      }
      {
        var draftAccept = RouteMatcher.Match("/api/v1/authoring/drafts/:draftId/accept", p);
        if (draftAccept is not null) return await Vpc.Review.Drafts.HandleAccept(req, res, auth, draftAccept["draftId"]);
        var draftReject = RouteMatcher.Match("/api/v1/authoring/drafts/:draftId/reject", p);
        if (draftReject is not null) return await Vpc.Review.Drafts.HandleReject(req, res, auth, draftReject["draftId"]);
        var draftOne = RouteMatcher.Match("/api/v1/authoring/drafts/:draftId", p);
        if (draftOne is not null) return await Vpc.Review.Drafts.HandleGetDraft(req, res, auth, draftOne["draftId"]);
      }
      if (p.EndsWith("/api/v1/authoring/qa/runs", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Qa.QaRuns.HandleRuns(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/qa/status", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Qa.QaRuns.HandleStatus(req, res, auth);
      }
      {
        var qaRun = RouteMatcher.Match("/api/v1/authoring/qa/runs/:runId", p);
        if (qaRun is not null) return await Vpc.Qa.QaRuns.HandleRun(req, res, auth, qaRun["runId"]);
        var qaWaive = RouteMatcher.Match("/api/v1/authoring/qa/runs/:runId/items/:cardId/waive", p);
        if (qaWaive is not null) return await Vpc.Qa.QaRuns.HandleWaiveItem(req, res, auth, qaWaive["runId"], qaWaive["cardId"]);
        var qaResolve = RouteMatcher.Match("/api/v1/authoring/qa/findings/:findingId/resolve", p);
        if (qaResolve is not null) return await Vpc.Qa.QaRuns.HandleResolveFinding(req, res, auth, qaResolve["findingId"]);
      }
      // R18A — automation
      if (p.EndsWith("/api/v1/authoring/automation/runner/heartbeat", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.RunnerRoutes.HandleHeartbeat(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/automation/runner/claim", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.RunnerRoutes.HandleClaim(req, res, auth);
      }
      if (p.EndsWith("/api/v1/authoring/automation/runner/complete", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.RunnerRoutes.HandleComplete(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/automation/queue", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.QueueRoutes.HandleQueue(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/automation/queue/:itemId/skip", p) is { } queueSkip)
      {
        return await Vpc.Automation.QueueRoutes.HandleSkip(req, res, auth, queueSkip["itemId"]);
      }
      if (p.EndsWith("/api/v1/admin/automation/notifications/test", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.Notifications.HandleTest(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/automation/notifications", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.Notifications.HandleList(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/automation/notifications/:notificationId", p) is { } notification)
      {
        return await Vpc.Automation.Notifications.HandleGet(req, res, auth, notification["notificationId"]);
      }
      if (p.EndsWith("/api/v1/admin/automation/watch", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.WatchAdminRoutes.HandleWatch(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/automation/watch/targets", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.WatchAdminRoutes.HandleTargets(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/automation/watch/targets/:targetId", p) is { } watchTarget)
      {
        return await Vpc.Automation.WatchAdminRoutes.HandleTarget(req, res, auth, watchTarget["targetId"]);
      }
      if (p.EndsWith("/api/v1/admin/automation/status", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.StatusRoutes.HandleStatus(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/automation/freshness", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.Freshness.HandleFreshness(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/analytics/usage", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Analytics.UsageAnalytics.HandleUsage(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/analytics/funnel", p) is not null)
      {
        return await Vpc.Analytics.AnonFunnel.HandleFunnel(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/automation/runs", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.StatusRoutes.HandleRuns(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/automation/decisions", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.StatusRoutes.HandleDecisions(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/automation/decisions/:draftId", p) is { } automationDecision)
      {
        return await Vpc.Automation.StatusRoutes.HandleDecision(req, res, auth, automationDecision["draftId"]);
      }
      if (p.EndsWith("/api/v1/admin/automation/eval-gate", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Automation.EvalGate.HandleGate(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/automation/eval-gate/:gateId/revoke", p) is { } gateRevoke)
      {
        return await Vpc.Automation.EvalGate.HandleRevoke(req, res, auth, gateRevoke["gateId"]);
      }
      // R20 V05 — card reports: triage (console) and report-a-card (learner, under /api/v1/user/ for the gateway)
      if (p.EndsWith("/api/v1/admin/card-reports", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Reports.CardReports.HandleAdminList(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/card-reports/:reportId/resolve", p) is { } cardReportResolve)
      {
        return await Vpc.Reports.CardReports.HandleResolve(req, res, auth, cardReportResolve["reportId"]);
      }
      if (p.EndsWith("/api/v1/user/card-reports", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Reports.CardReports.HandleUser(req, res, auth);
      }
      // R20 V06 — card embeddings (pushed from the owner's Mac) and semantic duplicates
      if (p.EndsWith("/api/v1/admin/card-embeddings/status", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.CardEmbeddings.HandleStatus(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/card-embeddings", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.CardEmbeddings.HandleUpsert(req, res, auth);
      }
      if (RouteMatcher.Match("/api/v1/admin/decks/:deckId/semantic-duplicates", p) is { } semanticDuplicates)
      {
        return await Vpc.Authoring.CardEmbeddings.HandleSemanticDuplicates(req, res, auth, semanticDuplicates["deckId"]);
      }
      // Runtime
      if (p.EndsWith("/api/v1/me", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.Me.HandleMe(req, res, auth);
      }
      if ((p.EndsWith("/api/v1/me", StringComparison.OrdinalIgnoreCase) ||
           p.EndsWith("/api/v1/user/me", StringComparison.OrdinalIgnoreCase)) &&
          req.Method.Equals("DELETE", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.AccountDeletion.HandleDeleteMe(req, res, auth);
      }
      if (p.EndsWith("/api/v1/user/client-errors", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.ClientErrors.HandleClientErrors(req, res, auth);
      }
      if (p.EndsWith("/api/v1/user/bootstrap", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.Bootstrap.HandleBootstrap(req, res, auth);
      }
      if (p.EndsWith("/api/v1/entitlements", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.Entitlements.HandleEntitlements(req, res, auth);
      }
      if (p.EndsWith("/api/v1/admin/manifest", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.AdminManifest.HandleAdminManifest(req, res, auth);
      }
      // Keyset-paginated console deck list (replaces loading the whole manifest/catalog).
      if (p.EndsWith("/api/v1/admin/decks", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Authoring.AdminDecks.HandleAdminDecks(req, res, auth);
      }

      if (
        (p.EndsWith("/api/v1/content/premium-url", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/api/v1/runtime/premium-url", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/api/v1/content/premium-url-dev", StringComparison.OrdinalIgnoreCase) ||
         p.EndsWith("/api/v1/runtime/premium-url-dev", StringComparison.OrdinalIgnoreCase)) &&
        req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
      {
        var isDevRoute = req.Path.EndsWith("-dev", StringComparison.Ordinal);
        var q = req.Query;
        var e = req;
        if (isDevRoute)
        {
          e = req.WithQuery("dev", "1").WithHeader("x-dev-bypass", "1");
          q = e.Query;
        }

        return await Vpc.Runtime.PremiumDeckUrl.HandlePremiumDeckUrl(e, q, res, auth);
      }

      if (p.EndsWith("/api/v1/sync/progress/events", StringComparison.OrdinalIgnoreCase) || p.EndsWith("/api/v1/sync/push", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.ProgressEvents.HandleProgressEvents(req, res, auth);
      }

      if (p.EndsWith("/api/v1/sync/progress", StringComparison.OrdinalIgnoreCase) || p.EndsWith("/api/v1/sync/pull", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.ProgressGet.HandleProgressGet(req, res, auth);
      }

      // Gamification state (collection, pity, wallet). Deliberately its own
      // route and not a field on the review sync: it is snapshot-shaped rather
      // than event-shaped, and keeping it separate is what lets a failure here
      // be silently skipped by the client without touching review sync.
      if (p.EndsWith("/api/v1/draw-state/sync", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Runtime.DrawStateSync.HandleDrawStateSync(req, res, auth);
      }

      // Admin users routes are retired (CBE-01). The console lists and creates editors
      // through edge-public's /api/v1/admin/cognito/users; core-vpc no longer answers a
      // 501 "TODO" here. It still recognises the old paths only to reject them with 404,
      // so legacy callers get a plain "route not found" and stay metered under their
      // bounded RouteMetrics labels rather than minting a metric per user id.
      {
        var goneUsers = RouteMatcher.Match("/api/v1/admin/users", p);
        var goneUser = RouteMatcher.Match("/api/v1/admin/users/:userSub", p);
        var goneEntitlements = RouteMatcher.Match("/api/v1/admin/users/:userSub/entitlements", p);
        if (goneUsers is not null || goneUser is not null || goneEntitlements is not null)
        {
          return res.NotFound("Route not found");
        }
      }

      // Internal routes. These are HMAC-signed machine-caller routes (two of them sit behind a gateway
      // route with no JWT authorizer), so they match their exact path, never a suffix: a suffix match
      // would let /api/internal/webhooks/<anything>/api/internal/<route> reach any of them.
      if (RouteMatcher.Match("/api/internal/entitlements/apply", p) is not null && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Internal.EntitlementsApply.HandleInternalEntitlementsApply(req, res);
      }
      if (RouteMatcher.Match("/api/internal/subscriptions/upsert", p) is not null && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
      {
        return await Vpc.Internal.SubscriptionsUpsert.HandleInternalSubscriptionsUpsert(req, res);
      }
      if (RouteMatcher.Match("/api/internal/webhooks/deliveries/report", p) is not null)
      {
        return await Vpc.Internal.WebhookDeliveryReport.HandleReport(req, res);
      }
      if (RouteMatcher.Match("/api/internal/ai-qa/results", p) is not null)
      {
        return await Vpc.Internal.AiQaResults.HandleAiQaResults(req, res);
      }
      if (RouteMatcher.Match("/api/internal/automation/tick", p) is not null)
      {
        return await Vpc.Automation.AutomationTick.HandleTick(req, res);
      }
      if (RouteMatcher.Match("/api/internal/automation/notifications/report", p) is not null)
      {
        return await Vpc.Automation.Notifications.HandleReport(req, res);
      }
      if (RouteMatcher.Match("/api/internal/source-watch/targets", p) is not null)
      {
        return await Vpc.Automation.SourceWatchRoutes.HandleTargets(req, res);
      }
      if (RouteMatcher.Match("/api/internal/source-watch/report", p) is not null)
      {
        return await Vpc.Automation.SourceWatchRoutes.HandleReport(req, res);
      }

      return res.NotFound("Route not found");
    }
    catch (Exception ex)
    {
      Log.Error("Unhandled error:", ex);
      return res.Error500(ex);
    }
  }
}
