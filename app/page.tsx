import type { Metadata } from "next";
import ConcertRushGame from "./game/ConcertRushGame";

export const metadata: Metadata = {
  title: "冲刺去演唱会",
  description: "跟着歌曲节拍穿过城市，收集门票与歌词碎片，准时抵达演唱会现场。",
};

export default function Home() {
  return <ConcertRushGame />;
}
