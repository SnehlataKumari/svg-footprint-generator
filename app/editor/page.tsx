import type { Metadata } from "next";
import { BrowserEditor } from "@/components/editor/browser-editor";
import { Editor } from "@/components/editor/editor";
import { getProject } from "@/lib/project";

export const metadata: Metadata = { title: "Editor" };

/** `npm run dev`: the editor saves straight into data/ and public/.
 *  Anywhere else (a deployed site has a read-only disk) — or with `?browser`
 *  in dev — it keeps everything in the visitor's browser instead. */
export default async function EditorPage({ searchParams }: { searchParams: Promise<{ scene?: string; browser?: string }> }) {
  const { scene, browser } = await searchParams;
  if (process.env.NODE_ENV === "development" && browser === undefined) {
    return <Editor initialProject={await getProject()} initialSceneId={scene} />;
  }
  return <BrowserEditor initialSceneId={scene} />;
}
