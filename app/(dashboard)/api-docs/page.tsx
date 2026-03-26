import { requireUser } from "@/src/lib/auth";
import ApiDocsClient from "./ApiDocsClient";

export const metadata = {
  title: "API Docs",
};

export default async function ApiDocsPage() {
  await requireUser();

  return <ApiDocsClient />;
}
