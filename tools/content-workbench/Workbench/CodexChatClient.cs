using System.Runtime.CompilerServices;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;

namespace ContentWorkbench;

/// <summary>One frozen user text and a JSON schema only; streams are buffered final updates, never token deltas.</summary>
public sealed class CodexChatClient(ICodexExecutor executor, IOptions<WorkbenchOptions> options) : IChatClient
{
    public async Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
    {
        var request = Validate(messages, options);
        var result = await executor.ExecuteAsync(request, cancellationToken);
        if (!result.Success) throw new ModelExecutionException(result);
        return new ChatResponse(new ChatMessage(ChatRole.Assistant, result.Output!))
        {
            ModelId = result.ReportedModel, FinishReason = ChatFinishReason.Stop,
            Usage = result.InputTokens is null && result.OutputTokens is null ? null : new UsageDetails { InputTokenCount = result.InputTokens, OutputTokenCount = result.OutputTokens },
            AdditionalProperties = new AdditionalPropertiesDictionary { ["workbench.execution"] = result with { Output = null }, ["workbench.streaming"] = "buffered_final" }
        };
    }
    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var response = await GetResponseAsync(messages, options, cancellationToken);
        var update = new ChatResponseUpdate(ChatRole.Assistant, response.Text) { ModelId = response.ModelId, FinishReason = response.FinishReason, AdditionalProperties = response.AdditionalProperties };
        if (response.Usage is { } usage) update.Contents.Add(new UsageContent(usage));
        yield return update;
    }
    private FrozenRequest Validate(IEnumerable<ChatMessage> messages, ChatOptions? chatOptions)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var list = messages.Take(2).ToArray();
        if (list.Length != 1 || list[0].Role != ChatRole.User || list[0].Contents.Count != 1 || list[0].Contents[0] is not TextContent text || string.IsNullOrWhiteSpace(text.Text))
            throw new NotSupportedException("Exactly one user message containing one frozen text is supported; system/assistant/tool roles and multimodal content are rejected.");
        if (list[0].AuthorName is not null || list[0].CreatedAt is not null || list[0].MessageId is not null || list[0].RawRepresentation is not null || list[0].AdditionalProperties is not null || text.RawRepresentation is not null || text.AdditionalProperties is not null)
            throw new NotSupportedException("Message/content metadata cannot be represented by the frozen stdin contract.");
        if (chatOptions is null || chatOptions.ResponseFormat is not ChatResponseFormatJson { Schema: { } schema })
            throw new NotSupportedException("An explicit JSON schema response format is required.");
        if (chatOptions.ModelId is not null && chatOptions.ModelId != options.Value.Model) throw new NotSupportedException("Model overrides are disabled.");
        // Fail closed for every present/future option this adapter cannot actually honor.
        foreach (var property in typeof(ChatOptions).GetProperties())
            if (property.Name is not (nameof(ChatOptions.ModelId) or nameof(ChatOptions.ResponseFormat)) && property.GetValue(chatOptions) is not null)
                throw new NotSupportedException($"Unsupported chat option: {property.Name}.");
        return new FrozenRequest(text.Text, schema.GetRawText());
    }
    public object? GetService(Type serviceType, object? serviceKey = null)
    {
        ArgumentNullException.ThrowIfNull(serviceType);
        if (serviceKey is not null) return null;
        if (serviceType == typeof(ChatClientMetadata)) return new ChatClientMetadata("codex-chatgpt-subscription", defaultModelId: options.Value.Model);
        return serviceType.IsInstanceOfType(this) ? this : null;
    }
    public void Dispose() { }
}
