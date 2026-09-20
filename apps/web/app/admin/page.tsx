import { auth } from "../../auth";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  return <section><p className="eyebrow">ADMINISTRATION</p><h1>Operations console</h1><p>Subscriber activation, API quota, job recovery, model diagnostics, and immutable audit events are exposed here as each operational slice is enabled.</p><div className="notice">Role validation occurs server-side. This screen contains no payment controls.</div></section>;
}
