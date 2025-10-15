using FluentValidation;

namespace Catalog.Application;

// Commands / DTOs
public record CreateDeckCmd(string Slug, string Title, string? Locale);
public record CreateDeckResult(Guid DeckId);

public record CreateDraftCardCmd(Guid DeckId, string StableUid, string FrontMd, string BackMd,
                                 string KeyPoint, IReadOnlyList<string>? Tags, string? Difficulty);
public record CreateDraftCardResult(Guid CardId, string StableUid);

public record PublishDeckCmd(Guid DeckId, string Version, string? Changelog);
public record PublishDeckResult(string Version, int TotalCards, DateTimeOffset PublishedAt);

// Service abstraction
public interface ICatalogAdminService
{
    Task<CreateDeckResult> CreateDeckAsync(CreateDeckCmd cmd, CancellationToken ct);
    Task<CreateDraftCardResult> CreateDraftCardAsync(CreateDraftCardCmd cmd, CancellationToken ct);
    Task<PublishDeckResult> PublishDeckAsync(PublishDeckCmd cmd, CancellationToken ct);
}

// Minimal validators（可选：先放宽，避免阻塞）
public sealed class CreateDeckCmdValidator : AbstractValidator<CreateDeckCmd>
{
    public CreateDeckCmdValidator()
    {
        RuleFor(x => x.Slug).NotEmpty().Length(3, 64).Matches("^[a-z0-9-]+$");
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
    }
}
public sealed class CreateDraftCardCmdValidator : AbstractValidator<CreateDraftCardCmd>
{
    public CreateDraftCardCmdValidator()
    {
        RuleFor(x => x.StableUid).NotEmpty().MaximumLength(120);
        RuleFor(x => x.KeyPoint).NotEmpty().MaximumLength(240);
        RuleFor(x => x.FrontMd).NotEmpty();
        RuleFor(x => x.BackMd).NotEmpty();
    }
}
public sealed class PublishDeckCmdValidator : AbstractValidator<PublishDeckCmd>
{
    public PublishDeckCmdValidator() => RuleFor(x => x.Version).NotEmpty().MaximumLength(40);
}