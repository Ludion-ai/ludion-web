using System.Text.RegularExpressions;

namespace Ludion.Wallpaper;

/// <summary>
/// アプリが開く住所の決まり。アプリが読むのは ludion.ai のページと API だけ（APP001「6」）。
/// 外から渡る値（ludion:// の住所、一覧の中身）は、ここで形を確かめてから使う。
/// </summary>
internal static partial class Links
{
    public const string Production = "https://ludion.ai";
    public const string Scheme = "ludion";

    /// <summary>作品の id の形（packages/rules の ID_PATTERN と同じ）。</summary>
    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    private static partial Regex IdPattern();

    public static bool IsWorkId(string? id) => id is { Length: > 0 and <= 64 } && IdPattern().IsMatch(id);

    /// <summary>
    /// 読みに行くサイト。ふだんは ludion.ai だけ。開発の確かめのときだけ、環境の変数 LUDION_ORIGIN で
    /// 手元の住所（http://localhost:… か http://127.0.0.1:…）に変えられる。ほかの住所は受けない。
    /// </summary>
    public static string Origin { get; } = ResolveOrigin(Environment.GetEnvironmentVariable("LUDION_ORIGIN"));

    internal static string ResolveOrigin(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return Production;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return Production;
        var local = uri.Scheme == Uri.UriSchemeHttp && (uri.Host == "localhost" || uri.Host == "127.0.0.1");
        return local && uri.AbsolutePath == "/" && uri.Query == "" ? uri.GetLeftPart(UriPartial.Authority) : Production;
    }

    /// <summary>全画面の住所（/p/&lt;id&gt;/wall。WALL001「1」）。</summary>
    public static Uri Wall(string id, string? origin = null) => new($"{origin ?? Origin}/p/{id}/wall");

    public static Uri WorksApi(string? origin = null) => new($"{origin ?? Origin}/api/works");

    public static string Thumb(string id, string version, string? origin = null) =>
        $"{origin ?? Origin}/w/{Uri.EscapeDataString(id)}/{Uri.EscapeDataString(version)}/thumb.webp";

    /// <summary>サイトの壁紙の一覧（ホームの「壁紙」のチップ。WALL001「3」）。</summary>
    public static Uri SiteWallpapers(string? origin = null) => new($"{origin ?? Origin}/?c=wallpaper");

    /// <summary>
    /// ludion://wall/&lt;id&gt; から作品の id を取り出す。ほかの形は null。
    /// ブラウザは終わりに / を足すことがあるので、1つだけ許す。
    /// </summary>
    public static string? ParseProtocol(string? argument)
    {
        // 書かれたままの文字で確かめる（Uri に通すと ../ が畳まれて、別の形が通ってしまう）
        if (string.IsNullOrEmpty(argument) || argument.Length > 128) return null;
        var match = ProtocolPattern().Match(argument);
        return match.Success && IsWorkId(match.Groups[1].Value) ? match.Groups[1].Value : null;
    }

    [GeneratedRegex("^ludion://wall/([a-z0-9-]+)/?$", RegexOptions.CultureInvariant)]
    private static partial Regex ProtocolPattern();

    /// <summary>壁紙の窓が開いてよい住所か。その作品の全画面の住所だけ（ほかへは移らない）。</summary>
    public static bool IsAllowedWallNavigation(string? target, string id, string? origin = null)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri)) return false;
        var expected = Wall(id, origin);
        return uri.Scheme == expected.Scheme
            && uri.Authority == expected.Authority
            && uri.AbsolutePath == expected.AbsolutePath;
    }
}
