import { createContext, useContext, useEffect, useRef, useState } from "react";

const YoutubeContext = createContext<any>(null);

export const YoutubeProvider = ({ children }: any) => {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [pos, setPos] = useState({ x: 20, y: 20 });
  const draggingRef = useRef(false);
  const pointerOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current || isFullscreen) return;
      setPos({
        x: e.clientX - pointerOffsetRef.current.x,
        y: e.clientY - pointerOffsetRef.current.y,
      });
    };

    const onPointerUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isFullscreen]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (isFullscreen) return;
    draggingRef.current = true;
    pointerOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    // capture pointer to ensure we continue receiving events
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const playYoutube = (url: string) => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
    if (match) setVideoId(match[1]);
  };

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);

  return (
    <YoutubeContext.Provider value={{ playYoutube }}>
      {children}

      {videoId && (
        <div
          onPointerDown={onPointerDown}
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            width: isFullscreen ? "100%" : "300px",
            height: isFullscreen ? "100%" : "170px",
            zIndex: 9999,
            cursor: isFullscreen ? "default" : "grab",
            transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
            touchAction: "none",
          }}
        >
          <iframe
            width="100%"
            height="100%"
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
            allow="autoplay"
            allowFullScreen
            style={{ border: 0 }}
          />
          <button
            onClick={toggleFullscreen}
            style={{
              position: "absolute",
              top: 5,
              right: 5,
              zIndex: 10,
              background: "rgba(0,0,0,0.6)",
              color: "#fff",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "12px",
            }}
          >
            {isFullscreen ? "Minimize" : "Fullscreen"}
          </button>
        </div>
      )}
    </YoutubeContext.Provider>
  );
};

export const useYoutubePlayer = () => useContext(YoutubeContext);

