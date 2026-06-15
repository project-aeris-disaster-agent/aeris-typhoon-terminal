import { redirect } from "next/navigation";

/** Legacy AERIS Chat deep links; dashboard home is the operator map. */
export default function ChatRedirectPage() {
  redirect("/");
}
