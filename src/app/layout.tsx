import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { getServerAuth } from "@/lib/supabase/server";
import { ProfileSync } from "@/lib/profileSync";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "UW GO",
  description: "Turn your Waterloo or Laurier class schedule into a day-by-day movement plan.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "UW GO", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f5f7",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Verified on the server for every render; the browser never decides who is signed in.
  const auth = await getServerAuth();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AuthProvider initial={{ mode: auth.mode, user: auth.user }}>
          <StoreProvider>
            {children}
            <ProfileSync />
          </StoreProvider>
        </AuthProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
