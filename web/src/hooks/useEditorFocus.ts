import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';

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
          showAccessibilityBanner(bannerRef);
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
              showAccessibilityBanner(bannerRef);
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
    'position:fixed;top:12px;right:12px;z-index:9999;max-width:360px;padding:12px 16px;' +
    'background:var(--surface-2);border:1px solid var(--border);border-radius:10px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,0.4);font-size:12px;color:var(--text-primary);' +
    'line-height:1.5;animation:fade-in 0.15s ease-out';
  banner.innerHTML =
    '<div style="font-weight:600;margin-bottom:4px">Enable editor auto-focus</div>' +
    '<div style="color:var(--text-secondary)">Grant accessibility access to your terminal app in ' +
    '<b>System Settings → Privacy & Security → Accessibility</b> ' +
    'so Paneful can detect your active editor project.</div>' +
    '<div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">' +
    '<button id="paneful-a11y-dismiss" style="padding:2px 8px;border-radius:6px;font-size:11px;' +
    'color:var(--text-primary);cursor:pointer;background:var(--surface-3);border:1px solid var(--border)">OK</button>' +
    '</div>';
  document.body.appendChild(banner);
  bannerRef.current = banner;

  banner.querySelector('#paneful-a11y-dismiss')?.addEventListener('click', () => {
    banner.remove();
    bannerRef.current = null;
  });
}
