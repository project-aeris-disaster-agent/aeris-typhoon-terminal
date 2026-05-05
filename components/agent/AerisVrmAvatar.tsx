"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRMLoaderPlugin,
  VRMHumanBoneName,
  VRMUtils,
  type VRM,
} from "@pixiv/three-vrm";

type AerisVrmAvatarProps = {
  isActive: boolean;
  isSpeaking: boolean;
};

const VRM_MODEL_URL = "/models/aeris-companion.vrm";
/** Bump when replacing the VRM on disk so production/CDN bypasses cached `?v=`. */
const VRM_ASSET_VERSION = "2";
const TARGET_FPS = 24;

function getModelUrl() {
  const version =
    process.env.NODE_ENV === "development"
      ? Date.now().toString()
      : VRM_ASSET_VERSION;
  return `${VRM_MODEL_URL}?v=${version}`;
}

const _headPos = new THREE.Vector3();
const _neckPos = new THREE.Vector3();

/** Face-centered portrait; ~2× tighter than medium head–waist framing. */
function frameAvatar(scene: THREE.Object3D, camera: THREE.PerspectiveCamera, vrm: VRM) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  scene.position.sub(center);
  scene.position.y -= size.y * 0.04;
  scene.updateMatrixWorld(true);

  const halfFovY = THREE.MathUtils.degToRad(camera.fov) / 2;
  const halfFovX = Math.atan(Math.tan(halfFovY) * Math.max(camera.aspect, 0.01));

  const bustHeight = size.y * 0.48;
  const bustWidth = Math.min(size.x * 0.48, size.y * 1.05);
  const distY = bustHeight / 2 / Math.tan(halfFovY);
  const distX = bustWidth / 2 / Math.tan(halfFovX);
  let distance = Math.max(distY, distX) * 0.84;
  distance *= 0.5;

  const head = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head);
  const neck = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck);
  let focusY = size.y * 0.33;
  if (head && neck) {
    head.getWorldPosition(_headPos);
    neck.getWorldPosition(_neckPos);
    focusY = _headPos.y * 0.42 + _neckPos.y * 0.58;
  } else if (head) {
    head.getWorldPosition(_headPos);
    focusY = _headPos.y - size.y * 0.06;
  }

  // Shift subject down in the frame by a fraction of viewport height (camera + target move up in world Y).
  const visibleHeight = 2 * distance * Math.tan(halfFovY);
  const frameShiftY = 0.2 * visibleHeight;
  const aimY = focusY + frameShiftY;

  camera.position.set(0, aimY, distance);
  camera.lookAt(0, aimY, 0);
  camera.updateProjectionMatrix();
}

function setMouthOpen(vrm: VRM, value: number) {
  const expressionManager = vrm.expressionManager;
  if (!expressionManager) return;

  expressionManager.setValue("aa", value);
  expressionManager.setValue("ih", value * 0.35);
  expressionManager.update();
}

export function AerisVrmAvatar({ isActive, isSpeaking }: AerisVrmAvatarProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const speakingRef = useRef(isSpeaking);
  const activeRef = useRef(isActive);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );

  useEffect(() => {
    speakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    activeRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 20);
    camera.position.set(0, 1.25, 3.1);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const keyLight = new THREE.DirectionalLight(0x9edcff, 1.8);
    keyLight.position.set(1.5, 2.4, 2);
    scene.add(keyLight);

    let vrm: VRM | null = null;
    let disposed = false;
    let animationId = 0;
    let lastFrame = 0;
    const clock = new THREE.Clock();

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      getModelUrl(),
      (gltf) => {
        if (disposed) return;
        vrm = gltf.userData.vrm as VRM | undefined ?? null;
        if (!vrm) {
          setStatus("fallback");
          return;
        }

        VRMUtils.removeUnnecessaryVertices(vrm.scene);
        VRMUtils.removeUnnecessaryJoints(vrm.scene);
        vrm.scene.rotation.y = 0;
        scene.add(vrm.scene);
        vrm.update(0);
        frameAvatar(vrm.scene, camera, vrm);
        renderer.render(scene, camera);
        setStatus("ready");
      },
      undefined,
      (error) => {
        console.warn("AGENT AERIS VRM failed to load", error);
        setStatus("fallback");
      },
    );

    const render = (time: number) => {
      animationId = window.requestAnimationFrame(render);
      if (!activeRef.current || document.hidden) return;
      if (time - lastFrame < 1000 / TARGET_FPS) return;
      lastFrame = time;

      const delta = clock.getDelta();
      const elapsed = clock.elapsedTime;
      if (vrm) {
        const mouth = speakingRef.current
          ? 0.12 + Math.abs(Math.sin(elapsed * 18)) * 0.72
          : 0;
        setMouthOpen(vrm, mouth);
        vrm.scene.rotation.z = Math.sin(elapsed * 1.4) * 0.015;
        vrm.update(delta);
      }

      renderer.render(scene, camera);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    animationId = window.requestAnimationFrame(render);

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(animationId);
      vrm?.scene.traverse((object) => {
        if ("geometry" in object) {
          (object.geometry as THREE.BufferGeometry | undefined)?.dispose();
        }
        if ("material" in object) {
          const material = object.material as
            | THREE.Material
            | THREE.Material[]
            | undefined;
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose());
          } else {
            material?.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-gradient-to-b from-aeris-accent/10 to-aeris-bg/20">
      <div ref={hostRef} className="absolute inset-0" aria-hidden />
      {status !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
          <div className="h-12 w-12 rounded-full border border-aeris-accent/30 bg-aeris-accent/10 shadow-[0_0_24px_rgba(45,212,191,0.14)]" />
          <div className="hud-text text-[9px] uppercase tracking-widest text-aeris-muted">
            {status === "loading" ? "Loading avatar" : "Avatar standby"}
          </div>
        </div>
      )}
    </div>
  );
}
