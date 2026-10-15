import { notFound } from "next/navigation";
import Gallery from "./Gallery";

// A living style guide for the shared components. Only available in `next dev`.
export default function UiGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
