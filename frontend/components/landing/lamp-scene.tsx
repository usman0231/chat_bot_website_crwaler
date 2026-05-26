"use client";

import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Stars } from "@react-three/drei";
import * as THREE from "three";

const ARM_MATERIAL = {
  color: "#cfd2dc",
  metalness: 0.85,
  roughness: 0.25,
} as const;

const JOINT_MATERIAL = {
  color: "#9aa0b2",
  metalness: 0.9,
  roughness: 0.2,
} as const;

function Lamp() {
  const rootRef = React.useRef<THREE.Group>(null);
  const headRef = React.useRef<THREE.Group>(null);
  const bulbRef = React.useRef<THREE.Mesh>(null);
  const spotRef = React.useRef<THREE.SpotLight>(null);
  const targetRef = React.useRef<THREE.Object3D>(null);

  React.useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current;
    }
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (rootRef.current) {
      rootRef.current.rotation.y = Math.sin(t * 0.4) * 0.25;
    }
    if (headRef.current) {
      headRef.current.rotation.x = 0.55 + Math.sin(t * 0.8) * 0.18;
      headRef.current.rotation.z = Math.sin(t * 0.6) * 0.1;
    }
    if (bulbRef.current) {
      const mat = bulbRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 2.4 + Math.sin(t * 3) * 0.35;
    }
  });

  return (
    <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.4}>
      <group ref={rootRef} position={[0, -1.1, 0]}>
        {/* Base */}
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.65, 0.75, 0.1, 48]} />
          <meshStandardMaterial color="#1f2233" metalness={0.7} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.5, 0.5, 0.04, 48]} />
          <meshStandardMaterial {...JOINT_MATERIAL} />
        </mesh>

        {/* Lower joint at base */}
        <mesh position={[0, 0.18, 0]}>
          <sphereGeometry args={[0.13, 24, 24]} />
          <meshStandardMaterial {...JOINT_MATERIAL} />
        </mesh>

        {/* Lower arm */}
        <group position={[0, 0.18, 0]} rotation={[0, 0, 0.35]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 1.1, 24]} />
            <meshStandardMaterial {...ARM_MATERIAL} />
          </mesh>

          {/* Knee joint */}
          <group position={[0, 1.1, 0]}>
            <mesh>
              <sphereGeometry args={[0.14, 24, 24]} />
              <meshStandardMaterial {...JOINT_MATERIAL} />
            </mesh>

            {/* Upper arm */}
            <group rotation={[0, 0, -0.95]}>
              <mesh position={[0, 0.5, 0]} castShadow>
                <cylinderGeometry args={[0.07, 0.07, 1, 24]} />
                <meshStandardMaterial {...ARM_MATERIAL} />
              </mesh>

              {/* Head joint */}
              <group position={[0, 1, 0]}>
                <mesh>
                  <sphereGeometry args={[0.14, 24, 24]} />
                  <meshStandardMaterial {...JOINT_MATERIAL} />
                </mesh>

                {/* Lamp head — tilts */}
                <group ref={headRef} rotation={[0.6, 0, 0]}>
                  {/* Shade — outer */}
                  <mesh position={[0, 0.28, 0]} castShadow>
                    <coneGeometry args={[0.45, 0.6, 48, 1, true]} />
                    <meshStandardMaterial
                      color="#6366f1"
                      metalness={0.4}
                      roughness={0.45}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                  {/* Shade — inner lit */}
                  <mesh position={[0, 0.28, 0]}>
                    <coneGeometry args={[0.42, 0.56, 48, 1, true]} />
                    <meshStandardMaterial
                      color="#fde68a"
                      emissive="#fbbf24"
                      emissiveIntensity={0.9}
                      side={THREE.BackSide}
                    />
                  </mesh>
                  {/* Shade cap */}
                  <mesh position={[0, 0.58, 0]}>
                    <sphereGeometry args={[0.13, 24, 24]} />
                    <meshStandardMaterial {...JOINT_MATERIAL} />
                  </mesh>

                  {/* Bulb */}
                  <mesh ref={bulbRef} position={[0, 0.1, 0]}>
                    <sphereGeometry args={[0.18, 32, 32]} />
                    <meshStandardMaterial
                      color="#fff8dc"
                      emissive="#fbbf24"
                      emissiveIntensity={2.4}
                      toneMapped={false}
                    />
                  </mesh>

                  {/* Bulb glow halo */}
                  <mesh position={[0, 0.1, 0]}>
                    <sphereGeometry args={[0.32, 24, 24]} />
                    <meshBasicMaterial
                      color="#fbbf24"
                      transparent
                      opacity={0.18}
                      depthWrite={false}
                    />
                  </mesh>

                  {/* Spotlight cast from bulb */}
                  <spotLight
                    ref={spotRef}
                    position={[0, 0.05, 0]}
                    angle={0.75}
                    penumbra={0.5}
                    intensity={6}
                    color="#fde68a"
                    distance={6}
                    decay={1.4}
                    castShadow
                  />
                  <object3D ref={targetRef} position={[0, -2, 0]} />

                  <pointLight
                    color="#fbbf24"
                    intensity={1.2}
                    distance={2.5}
                    position={[0, 0.1, 0]}
                  />
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </Float>
  );
}

function ParticleField() {
  const count = 200;
  const positions = React.useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    return pos;
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#818cf8"
        size={0.02}
        transparent
        opacity={0.6}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

export default function LampScene() {
  return (
    <Canvas
      camera={{ position: [2.2, 0.6, 4.2], fov: 42 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      shadows
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.25} color="#6366f1" />
      <hemisphereLight
        color="#a78bfa"
        groundColor="#0b0b1a"
        intensity={0.4}
      />
      <directionalLight
        position={[-4, 3, 2]}
        intensity={0.4}
        color="#c4b5fd"
      />

      <Stars
        radius={10}
        depth={5}
        count={300}
        factor={2}
        saturation={0}
        fade
        speed={0.5}
      />
      <ParticleField />
      <Lamp />
    </Canvas>
  );
}
