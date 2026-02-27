import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';

const DISMISSED_KEY = 'paneful:accessibility-dismissed';

export function useEditorFocus() {
  const hasAccessRef = useRef<boolean | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Check accessibility on mount
    fetch('/api/active-editor')
      .then((r) => r.json())
      .then(({ needsAccessibility }: { projectName: string | null; needsAccessibility?: boolean }) => {
        if (needsAccessibility) {
          hasAccessRef.current = false;
          if (localStorage.getItem(DISMISSED_KEY) !== '1') {
            showAccessibilityBanner(bannerRef);
          }
        } else {
          hasAccessRef.current = true;
        }
      })
      .catch(() => {});

    const onFocus = () => {
      fetch('/api/active-editor')
        .then((r) => r.json())
        .then(({ projectName, needsAccessibility }: { projectName: string | null; needsAccessibility?: boolean }) => {
          if (needsAccessibility) {
            if (hasAccessRef.current !== false) {
              hasAccessRef.current = false;
              if (localStorage.getItem(DISMISSED_KEY) !== '1') {
                showAccessibilityBanner(bannerRef);
              }
            }
            return;
          }

          // Access was just granted — remove banner if showing
          if (hasAccessRef.current === false && !needsAccessibility) {
            hasAccessRef.current = true;
            bannerRef.current?.remove();
            bannerRef.current = null;
          }

          if (!projectName) return;
          const { projects, activeProjectId, setActiveProject } = useProjectStore.getState();
          const match = Object.values(projects).find((p) => {
            const folderName = p.cwd.replace(/\/$/, '').split('/').pop();
            return p.name === projectName || folderName === projectName;
          });
          if (match && match.id !== activeProjectId) {
            setActiveProject(match.id);
          }
        })
        .catch(() => {});
    };

    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      bannerRef.current?.remove();
    };
  }, []);
}

function showAccessibilityBanner(bannerRef: React.MutableRefObject<HTMLDivElement | null>) {
  if (bannerRef.current) return; // already showing

  const banner = document.createElement('div');
  banner.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:9999;max-width:400px;padding:12px 16px;' +
    'background:var(--surface-2);border:1px solid var(--border);border-radius:10px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,0.4);font-size:12px;color:var(--text-primary);' +
    'line-height:1.5;animation:fade-in 0.15s ease-out';
  banner.innerHTML =
    '<div style="font-weight:600;margin-bottom:6px">Editor auto-focus (macOS)</div>' +
    '<div style="color:var(--text-secondary);margin-bottom:8px">' +
    'Paneful can automatically switch to the matching project when you tab back from your editor. This requires two things:</div>' +
    '<div style="color:var(--text-secondary);margin-bottom:4px">' +
    '<b>1. Accessibility access</b><br>' +
    'Add your terminal app (the one running Paneful) to:<br>' +
    '<b>System Settings → Privacy & Security → Accessibility</b></div>' +
    '<div style="color:var(--text-secondary);margin-bottom:4px">' +
    '<b>2. Editor window title must contain the folder path</b><br>' +
    'In VS Code / Cursor, set <code style="font-size:11px;padding:1px 4px;background:var(--surface-0);border:1px solid var(--border);border-radius:4px">window.title</code> to include <code style="font-size:11px;padding:1px 4px;background:var(--surface-0);border:1px solid var(--border);border-radius:4px">${rootPath}</code> or <code style="font-size:11px;padding:1px 4px;background:var(--surface-0);border:1px solid var(--border);border-radius:4px">${folderName}</code>.<br>' +
    'The default title works out of the box.</div>' +
    '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end">' +
    '<button id="paneful-a11y-dismiss-forever" style="padding:3px 10px;border-radius:6px;font-size:11px;color:var(--text-muted);cursor:pointer;background:none;border:none">Don\'t show again</button>' +
    '<button id="paneful-a11y-dismiss" style="padding:3px 10px;border-radius:6px;font-size:11px;color:var(--text-primary);cursor:pointer;background:var(--surface-3);border:1px solid var(--border)">OK</button>' +
    '</div>';
  document.body.appendChild(banner);
  bannerRef.current = banner;

  banner.querySelector('#paneful-a11y-dismiss')?.addEventListener('click', () => {
    banner.remove();
    bannerRef.current = null;
  });
  banner.querySelector('#paneful-a11y-dismiss-forever')?.addEventListener('click', () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    banner.remove();
    bannerRef.current = null;
  });
}
