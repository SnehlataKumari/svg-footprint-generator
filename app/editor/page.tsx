import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Editor } from "@/components/editor/editor";
import { getProject } from "@/lib/project";

export const metadata: Metadata = { title: "Editor" };

/** The editor saves straight into data/ and public/, so it only exists in
 *  `npm run dev`. A production build 404s here. */
export default async function EditorPage({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { scene } = await searchParams;
  return <Editor initialProject={await getProject()} initialSceneId={scene} />;
}
