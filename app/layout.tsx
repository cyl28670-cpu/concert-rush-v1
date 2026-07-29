import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "冲刺去演唱会",
  description: "一款手机竖屏像素音乐跑酷游戏。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
