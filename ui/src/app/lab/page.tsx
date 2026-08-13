import { LabDashboardClient } from "@/app/lab/LabDashboardClient";
import {
  LAB_DESCRIPTION,
  buildPageSiteMetadata,
} from "@/lib/seo/site-metadata";

export const metadata = buildPageSiteMetadata({
  path: "/lab",
  title: "Security lab",
  description: LAB_DESCRIPTION,
});

export default function LabPage() {
  return <LabDashboardClient />;
}
