using System.Security.Cryptography;
using System.Text;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// Deterministic ids for rows the automation creates exactly once per source record (A00 §5.6, e.g. the QA mirror
/// run <c>qa-mirror:&lt;draftId&gt;</c>): the <c>WebhookEvents.DerivedEventId</c> algorithm (RFC 9562 version 8,
/// the first 128 bits of SHA-256 with the version and variant bits set) over <see cref="Prefix"/> + name.
/// </summary>
public static class AutomationIds
{
  public const string Prefix = "developercards-automation:";

  public static Guid Derived(string name)
  {
    var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(Prefix + name))[..16];
    bytes[6] = (byte)((bytes[6] & 0x0F) | 0x80);
    bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
    // The 32-hex-digit text form is read in network (big-endian) order, so the version nibble lands in place.
    return Guid.ParseExact(Convert.ToHexString(bytes), "N");
  }
}
