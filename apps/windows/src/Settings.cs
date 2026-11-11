using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ludion.Wallpaper;

/// <summary>
/// アプリの設定。この PC の中（%LOCALAPPDATA%\Ludion\settings.json）にだけ置き、どこへも送らない（APP001「6」）。
/// </summary>
internal sealed class Settings
{
    /// <summary>選んだ壁紙の作品の id。まだ選んでいなければ null。</summary>
    public string? WallpaperId { get; set; }

    /// <summary>音は初めは消しておく（APP001「4」）。</summary>
    public bool Muted { get; set; } = true;

    /// <summary>止める（通知領域から）。</summary>
    public bool Paused { get; set; }

    /// <summary>電池で動いている間は止める。初めは「止める」。</summary>
    public bool PauseOnBattery { get; set; } = true;

    public static string Folder { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Ludion");

    private static string FilePath => Path.Combine(Folder, "settings.json");

    public static Settings Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return new Settings();
            var settings = JsonSerializer.Deserialize(File.ReadAllText(FilePath), SettingsJson.Default.Settings) ?? new Settings();
            if (!Links.IsWorkId(settings.WallpaperId)) settings.WallpaperId = null;
            return settings;
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return new Settings();
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Folder);
            var temp = FilePath + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(this, SettingsJson.Default.Settings));
            File.Move(temp, FilePath, overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Log.Write($"settings: {error.Message}");
        }
    }
}

[JsonSerializable(typeof(Settings))]
[JsonSourceGenerationOptions(WriteIndented = true)]
internal sealed partial class SettingsJson : JsonSerializerContext;

/// <summary>
/// 確かめのための記録。環境の変数 LUDION_LOG=1 のときだけ、この PC の中に書く（送らない）。
/// </summary>
internal static class Log
{
    private static readonly bool Enabled = Environment.GetEnvironmentVariable("LUDION_LOG") == "1";
    private static readonly object Gate = new();

    public static void Write(string message)
    {
        if (!Enabled) return;
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(Settings.Folder);
                File.AppendAllText(Path.Combine(Settings.Folder, "log.txt"), $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
            }
            catch (IOException)
            {
            }
        }
    }
}
