"use client";

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;

  /**
   * Whether this page was already under a worker's control when the script
   * ran. Distinguishes "a new worker replaced an old one" (recover) from
   * "the very first worker just claimed us" (nothing to recover from).
   */
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  /**
   * Self-heal after a worker upgrade.
   *
   * sw.js v3 served the HTML document from cache, so a returning visitor got
   * the previous deploy's markup pointing at content-hashed chunks that no
   * longer existed — the page died with "a client-side exception has
   * occurred". v4 fixes the caching, but a browser already holding the bad
   * markup renders the broken page *once* before the new worker takes over.
   * Reloading the moment control changes turns that into a flicker instead of
   * a dead end, which matters when the thing being loaded is a storm map.
   *
   * Guarded twice so it can never loop: only when replacing an existing
   * worker, and only once per page.
   */
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const register = () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              window.dispatchEvent(new Event("aeris:update-available"));
            }
          });
        });
      })
      .catch(() => {
        console.warn("AERIS service worker registration failed.");
      });
  };

  /**
   * `load` may already have fired by the time this effect runs — React mounts
   * after the load event on a warm cache — and a listener attached then never
   * fires, silently leaving the visitor with no worker and no offline support.
   * Register immediately in that case.
   */
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }

  window.addEventListener("online", () => {
    navigator.serviceWorker.controller?.postMessage("flush-queue");
  });
}
