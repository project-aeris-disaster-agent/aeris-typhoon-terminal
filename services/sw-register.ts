"use client";

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;

  window.addEventListener("load", () => {
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
  });

  window.addEventListener("online", () => {
    navigator.serviceWorker.controller?.postMessage("flush-queue");
  });
}
