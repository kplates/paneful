use std::process::Command;
use tracing::{info, warn};

/// Open the browser in app mode (chromeless window) so keyboard shortcuts like
/// Cmd+N, Cmd+W, Cmd+T are handled by JavaScript instead of the browser chrome.
pub fn open_browser(port: u16) {
    let url = format!("http://localhost:{}", port);
    info!("Opening browser at {}", url);

    // Try Chrome/Chromium in --app mode first (no browser chrome = no shortcut conflicts)
    if try_chrome_app_mode(&url) {
        return;
    }

    // Fallback: open normally and tell the user about PWA install
    info!("No Chromium-based browser found for app mode, falling back to default browser");
    if let Err(e) = open::that(&url) {
        warn!("Failed to open browser: {}", e);
    }
    eprintln!("Tip: Install as a PWA (browser menu > 'Install Paneful') for full keyboard shortcut support");
}

fn try_chrome_app_mode(url: &str) -> bool {
    // macOS browser paths in order of preference
    #[cfg(target_os = "macos")]
    {
        let browsers = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Arc.app/Contents/MacOS/Arc",
        ];

        for browser in &browsers {
            if std::path::Path::new(browser).exists() {
                let app_arg = format!("--app={}", url);
                match Command::new(browser).arg(&app_arg).spawn() {
                    Ok(_) => {
                        info!("Opened in app mode via {}", browser);
                        return true;
                    }
                    Err(e) => {
                        warn!("Failed to launch {}: {}", browser, e);
                    }
                }
            }
        }
    }

    // Linux browser paths
    #[cfg(target_os = "linux")]
    {
        let browsers = [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
            "brave-browser",
        ];

        for browser in &browsers {
            let app_arg = format!("--app={}", url);
            if Command::new(browser)
                .arg(&app_arg)
                .spawn()
                .is_ok()
            {
                info!("Opened in app mode via {}", browser);
                return true;
            }
        }
    }

    false
}
