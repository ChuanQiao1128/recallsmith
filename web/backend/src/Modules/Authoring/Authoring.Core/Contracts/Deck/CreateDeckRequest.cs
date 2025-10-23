using System.ComponentModel.DataAnnotations;

namespace Authoring.Core.Contracts.Deck;

public sealed class CreateDeckRequest
{
    [Required, StringLength(100)]
    public string Slug { get; set; } = default!;

    [Required, StringLength(200)]
    public string Title { get; set; } = default!;

    [StringLength(20)]
    public string? Locale { get; set; }
}