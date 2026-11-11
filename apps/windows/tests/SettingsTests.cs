using System.Text.Json;
using Ludion.Wallpaper;
using Xunit;

public class SettingsTests
{
    [Fact]
    public void OlderSettingsTurnOnTheWallpaperAndPassClicks()
    {
        // 0.1.0 の設定（新しい2つがない）を読んでも、壁紙はオン、クリックは渡す
        var old = """{ "WallpaperId": "wallpaper-rain-window", "Muted": true, "Paused": false, "PauseOnBattery": true }""";
        var settings = JsonSerializer.Deserialize(old, SettingsJson.Default.Settings)!;
        Assert.True(settings.WallpaperOn);
        Assert.True(settings.ForwardClicks);
        Assert.Equal("wallpaper-rain-window", settings.WallpaperId);
    }

    [Fact]
    public void OffIsKept()
    {
        var settings = JsonSerializer.Deserialize("""{ "WallpaperOn": false, "ForwardClicks": false }""", SettingsJson.Default.Settings)!;
        Assert.False(settings.WallpaperOn);
        Assert.False(settings.ForwardClicks);
    }

    [Fact]
    public void PickerStateHasTheNamesThePageReads()
    {
        var json = JsonSerializer.Serialize(new PickerState("state", On: false, Startup: true, StartupInWindowsSettings: false), CatalogJson.Default.PickerState);
        Assert.Equal("""{"type":"state","on":false,"startup":true,"startupInWindowsSettings":false}""", json);
    }
}
