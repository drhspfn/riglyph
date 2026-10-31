import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { WebPlayer } from "@riglyph/player-web";

type Animation = {
  id: string;
  name: string;
  durationSec: number;
};

type Skin = {
  id: string;
  isDefault: boolean;
};

type SkeletonViewProps = {
  assetUrl: string;
  initialAnimation?: string;
};

export function SkeletonView({
  assetUrl,
  initialAnimation = "1to2",
}: SkeletonViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<WebPlayer | null>(null);

  const [animations, setAnimations] = useState<Animation[]>([]);
  const [skins, setSkins] = useState<Skin[]>([]);
  const [animation, setAnimation] = useState(initialAnimation);
  const [skin, setSkin] = useState("");
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [mix, setMix] = useState(0.3);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let player: WebPlayer | null = null;

    setLoading(true);
    setError("");

    const init = async () => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;

      const { createPlayer } = await import("@riglyph/player-web");

      const p = await createPlayer({
        canvas,
        assetUrl,
        enableControls: true,
        autoResize: true,
      });

      if (cancelled) {
        p.dispose();
        return;
      }

      player = p;
      playerRef.current = p;

      const clips = p.animations();
      const availableSkins = p.skins();

      setAnimations(clips);
      setSkins(availableSkins);

      const selected =
        clips.find(
          (clip) =>
            clip.id === initialAnimation || clip.name === initialAnimation,
        ) ?? clips[0];

      p.setSpeed(speed);
      p.setDefaultMix(mix);
      p.setLoop(loop);

      if (selected) {
        setAnimation(selected.id);
        setDuration(selected.durationSec);
        p.play(selected.id, { loop });
        setPlaying(true);
      }

      setLoading(false);

      const update = () => {
        if (cancelled) return;

        const status = p.status;
        const diagnostics = p.diagnostics();

        setTime(diagnostics.sampledClipTimeSec);
        setPlaying(status.playing);

        frame = requestAnimationFrame(update);
      };

      frame = requestAnimationFrame(update);
    };

    void init().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      playerRef.current = null;
      player?.dispose();
    };
  }, [assetUrl, initialAnimation]);

  const changeAnimation = (id: string) => {
    const p = playerRef.current;
    if (!p) return;

    try {
      p.transitionTo(id, {
        loop,
        mixDurationSec: mix,
        track: 0,
      });

      if (!p.status.playing) {
        p.play(id, { loop });
      }

      setAnimation(id);
      setDuration(animations.find((item) => item.id === id)?.durationSec ?? 0);
      setTime(0);
      setPlaying(true);
    } catch (err) {
      setError(String(err));
    }
  };

  const togglePlayback = () => {
    const p = playerRef.current;
    if (!p) return;

    if (p.status.playing) {
      p.pause();
      setPlaying(false);
    } else {
      p.play(animation, { loop });
      setPlaying(true);
    }
  };

  const changeSpeed = (value: number) => {
    playerRef.current?.setSpeed(value);
    setSpeed(value);
  };

  const changeLoop = (value: boolean) => {
    playerRef.current?.setLoop(value);
    setLoop(value);
  };

  const changeMix = (value: number) => {
    playerRef.current?.setDefaultMix(value);
    setMix(value);
  };

  const changeSkin = (value: string) => {
    try {
      playerRef.current?.setSkin(value || null);
      setSkin(value);
    } catch (err) {
      setError(String(err));
    }
  };

  const seek = (value: number) => {
    playerRef.current?.seek(value);
    setTime(value);
  };

  const zoom = (factor: number) => {
    playerRef.current?.zoom(factor);
  };

  const fit = (padding: number) => {
    playerRef.current?.setCamera({ mode: "fit-scene", padding });
  };

  const buttonStyle: React.CSSProperties = {
    background: "#252b38",
    color: "#f0f3fa",
    border: "1px solid #454c5e",
    borderRadius: 6,
    padding: "8px 12px",
    cursor: "pointer",
  };

  const selectStyle: React.CSSProperties = {
    ...buttonStyle,
    minWidth: 130,
  };

  return (
    <div
      style={{
        width: "100%",
        background: "#151923",
        color: "#edf0f6",
        fontFamily: "system-ui, sans-serif",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Viewer */}
      <div
        style={{
          width: "100%",
          aspectRatio: "2.4 / 1",
          background: "#11151e",
          position: "relative",
        }}
      >
        <canvas
          ref={canvasRef}
          width={1440}
          height={600}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
          }}
        />

        {loading && (
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
            }}
          >
            Loading scene...
          </div>
        )}
      </div>

      {/* Timeline */}
      <div style={{ padding: "12px 16px 4px" }}>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={0.001}
          value={Math.min(time, Math.max(duration, 0.001))}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={loading || duration <= 0}
          style={{ width: "100%", cursor: "pointer" }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "#9aa5b8",
          }}
        >
          <span>{time.toFixed(2)} s</span>
          <span>{duration.toFixed(2)} s</span>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          padding: 16,
        }}
      >
        <button
          style={buttonStyle}
          onClick={togglePlayback}
          disabled={loading || !animations.length}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>

        <button style={buttonStyle} onClick={() => seek(0)}>
          ↺ Restart
        </button>

        <select
          style={selectStyle}
          value={animation}
          onChange={(e) => changeAnimation(e.target.value)}
        >
          {animations.map((clip) => (
            <option key={clip.id} value={clip.id}>
              {clip.name || clip.id}
            </option>
          ))}
        </select>

        <label>
          Speed{" "}
          <select
            style={selectStyle}
            value={speed}
            onChange={(e) => changeSpeed(Number(e.target.value))}
          >
            {[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => changeLoop(e.target.checked)}
          />
          Loop
        </label>

        {skins.length > 0 && (
          <label>
            Skin{" "}
            <select
              style={selectStyle}
              value={skin}
              onChange={(e) => changeSkin(e.target.value)}
            >
              <option value="">Default</option>
              {skins
                .filter((s) => !s.isDefault)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
            </select>
          </label>
        )}

        <label>
          Mix{" "}
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={mix}
            onChange={(e) => changeMix(Number(e.target.value))}
            style={{ width: 55 }}
          />{" "}
          s
        </label>

        <button style={buttonStyle} onClick={() => zoom(0.8)}>
          +
        </button>

        <button style={buttonStyle} onClick={() => zoom(1.25)}>
          −
        </button>

        <button style={buttonStyle} onClick={() => fit(1)}>
          Fit
        </button>

        <button style={buttonStyle} onClick={() => fit(1.25)}>
          Fit + Margin
        </button>
      </div>

      {error && (
        <div
          style={{
            color: "#ff9090",
            padding: "0 16px 16px",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          padding: "0 16px 12px",
          color: "#7f8a9e",
          fontSize: 12,
        }}
      >
        Mouse wheel: Zoom · Drag: Pan · Riglyph v0.15.1
      </div>
    </div>
  );
}

// Demo entrypoint
createRoot(document.getElementById("root")!).render(
  <div
    style={{
      maxWidth: 1440,
      margin: "24px auto",
      padding: 16,
    }}
  >
    <SkeletonView
      assetUrl="/assets/scene/manifest.json"
      initialAnimation="1to2"
    />
  </div>
);
