const IGNROED_HOSTS = new Set([
  "www.google.com",
  "www.gstatic.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

const IGNORED_PATHS = [
  /\/(images|_next\/image)\//,
  /\/(images|_next\/image)\//,
  /.*\.(webp|png|jpe?g|svg)(\?.*)?$/,
];

export function extractUrls(text: string, base: URL): string[] {
  // plain URL
  const plain = text.match(/\bhttps?:\/\/[^\s<>)"'!]+/gi) ?? [];
  const markdownLinks = text.match(/[^!]\[([^\]]*)\]\(([^)!]+)\)/g) ?? [];
  // get the captured URL
  const markdownUrls = markdownLinks.map(
    (link) => link.match(/\(([^)!]+)\)/)?.[1] ?? "",
  );
  let result: Set<string> = new Set();
  for (const href of [...plain, ...markdownUrls]) {
    let url;
    try {
      url = new URL(href, base);
    } catch (e) {
      continue;
    }
    if (IGNROED_HOSTS.has(url.host)) {
      continue;
    }
    if (IGNORED_PATHS.some((re) => re.test(url.pathname))) {
      continue;
    }
    url.hash = "";
    if (url.href === base.href) {
      continue;
    }
    result.add(url.href);
  }
  return Array(...result);
}
