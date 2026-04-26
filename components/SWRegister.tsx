"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/services/sw-register";

export function SWRegister() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
