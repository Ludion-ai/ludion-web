using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Ludion.Wallpaper;

/// <summary>Ludion の壁紙の一覧（/api/works の中で、種類が壁紙のもの）。読むだけで、何も送らない。</summary>
internal static class Catalog
{
    public const string WallpaperSubtype = "Wallpaper";

    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        // 名前と版だけ（人や PC を分ける値は入れない）
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"Ludion-Windows/{Application.ProductVersion.Split('+')[0]}");
        return client;
    }

    public static async Task<IReadOnlyList<WallpaperItem>> LoadAsync(CancellationToken cancel = default)
    {
        var response = await Http.GetFromJsonAsync(Links.WorksApi(), CatalogJson.Default.WorksResponse, cancel);
        return Select(response);
    }

    /// <summary>壁紙だけを、形を確かめて取り出す。</summary>
    internal static IReadOnlyList<WallpaperItem> Select(WorksResponse? response, string? origin = null)
    {
        var items = new List<WallpaperItem>();
        foreach (var work in response?.Works ?? [])
        {
            if (work.Subtype != WallpaperSubtype || !Links.IsWorkId(work.Id) || string.IsNullOrEmpty(work.Version)) continue;
            items.Add(new WallpaperItem(
                work.Id!,
                work.Title ?? work.Id!,
                work.Creator?.Name ?? work.Creator?.Handle ?? "",
                work.Creator?.Kind == "label",
                Links.Thumb(work.Id!, work.Version!, origin),
                work.ThumbW is > 0 ? work.ThumbW.Value : 800,
                work.ThumbH is > 0 ? work.ThumbH.Value : 450));
        }
        return items;
    }
}

internal sealed record WallpaperItem(string Id, string Title, string Creator, bool Label, string Thumb, int Width, int Height);

internal sealed class WorksResponse
{
    [JsonPropertyName("works")] public List<WorkJson>? Works { get; set; }
}

internal sealed class WorkJson
{
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("subtype")] public string? Subtype { get; set; }
    [JsonPropertyName("version")] public string? Version { get; set; }
    [JsonPropertyName("thumb_w")] public int? ThumbW { get; set; }
    [JsonPropertyName("thumb_h")] public int? ThumbH { get; set; }
    [JsonPropertyName("creator")] public CreatorJson? Creator { get; set; }
}

internal sealed class CreatorJson
{
    [JsonPropertyName("handle")] public string? Handle { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("kind")] public string? Kind { get; set; }
}

/// <summary>一覧の窓へ渡す中身。</summary>
internal sealed record PickerMessage(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("lang")] string Lang,
    [property: JsonPropertyName("current")] string? Current,
    [property: JsonPropertyName("works")] IReadOnlyList<WallpaperItem> Works);

[JsonSerializable(typeof(WorksResponse))]
[JsonSerializable(typeof(PickerMessage))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
internal sealed partial class CatalogJson : JsonSerializerContext;
