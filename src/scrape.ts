import * as puppeteer from "puppeteer";

type Page = {
  title: string;
  body: string;
  error?: Error;
};

type FetchOptions = {
  scrollToBottom?: boolean;
  waitForNetworkIdle?: number;
};

export class Scraper {
  private browser: Promise<puppeteer.Browser>;
  constructor(private options: puppeteer.LaunchOptions) {
    this.browser = puppeteer.launch({ ...options });
  }
  public async dispose() {
    const browser = await this.browser;
    const pages = await browser.pages();
    for (const page of pages) {
      await page.close();
    }
    if (browser.connected) {
      await browser.close();
    }
  }

  async fetch(url: string, options: FetchOptions): Promise<Page> {
    let browser = await this.browser;

    if (!browser.connected) {
      await browser.close();
      let getBrowser = puppeteer.launch(this.options);
      this.browser = getBrowser;
      browser = await getBrowser;
    }

    const page = await browser.newPage();

    // pretend to be a real User Agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
    );

    try {
      await page.goto(url);

      if (options.waitForNetworkIdle) {
        try {
          await page.waitForNetworkIdle({ timeout: 5000 });
        } catch (_) {
        }
      }

      const bodyHandle = await page.$("html");

      if (options.scrollToBottom){
        await scrollToBottom(page);
      }

      const title = await page.title();

      const body = await page.evaluate((body) => {
        return body?.innerHTML;
      }, bodyHandle);
      if (body === undefined) {
        throw new Error("Failed to scrape text from HTML");
      }
      return { title, body };
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        return { title: "", body: "", error: e };
      } else {
        throw e;
      }
    } finally {
      if (!page.isClosed()) {
        await page.close();
      }
    }
  }
}

// handle incremental loading
// https://github.com/puppeteer/puppeteer/issues/305#issuecomment-385145048
async function scrollToBottom(page: puppeteer.Page): Promise<void> {
  await page.evaluate(async () => {
    const SCROLL_DELAY = 50;
    const SCROLL_DISTANCE = 100;

    await new Promise((resolve, _reject) => {
      let totalHeight = 0;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, SCROLL_DISTANCE);
        totalHeight += SCROLL_DISTANCE;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve(void 0);
        }
      }, SCROLL_DELAY);
    });
  });
}
