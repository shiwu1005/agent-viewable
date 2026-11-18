import { useEffect } from "react";
import { Scene } from "./stage/Scene";
import { Hud } from "./ui/Hud";
import { Inspector } from "./ui/Inspector";
import { startFeed } from "./probe/source";
import { installProbe } from "./dev/devkit";
import { useOffice } from "./probe/model";

export default function App() {
  useEffect(() => {
    // 逐帧录制时由脚本自己喂事件，别再挂实时源，否则会和脚本打架
    const capturing = new URLSearchParams(location.search).has("capture");
    if (!capturing) startFeed();
  }, []);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__office = useOffice;
    installProbe();
  }, []);

  // ?inspector=0 可以关掉调参面板（录片时用）
  const showInspector = new URLSearchParams(location.search).get("inspector") !== "0";

  return (
    <div className="app">
      <div className="stage">
        <Scene />
      </div>
      <Hud />
      {showInspector && <Inspector />}
    </div>
  );
}
