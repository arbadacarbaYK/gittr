import { jsonLdScriptHtml } from "./json-ld";

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScriptHtml(data) }}
    />
  );
}
