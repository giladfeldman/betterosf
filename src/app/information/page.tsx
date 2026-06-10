// /information is unified into /about. Keep the route as a redirect so existing
// links and bookmarks don't 404.
import { redirect } from "next/navigation";

export default function InformationPage() {
  redirect("/about");
}
