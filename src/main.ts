import { PlaywrightCrawler } from 'crawlee'

import { generateEmbeddings } from './lib/generate-embeddings.js'
import { DocMetadata } from './types/docs.js'
import { RealtimeChannel } from '@supabase/supabase-js'

export async function runCrawler(
  websiteUrl: string,
  match: string,
  cssSelector: string,
  maxPagesToCrawl: number,
  pineconeApiKey: string,
  pineconeEnvironment: string,
  pineconeIndexName: string,
  openaiApiKey: string,
  projectId: string,
  projectChannel: RealtimeChannel
) {
  let data: DocMetadata[] = []
  const saveData = ({ title, url, text }: DocMetadata) => {
    // TODO: optimise to check if doc with title already exist in data
    let isExist = false
    data.forEach((d) => {
      if (d.url === url) {
        isExist = true
        return
      }
    })
    if (!isExist) data.push({ title, url, text })
  }

  const crawler = new PlaywrightCrawler({
    requestHandler: async ({ page, request, enqueueLinks, log }) => {
      await enqueueLinks({
        globs: typeof match === 'string' ? [match] : match // Queue all link with this pattern to crawl
      })

      const title = await page.title()

      projectChannel.send({
        type: 'broadcast',
        event: 'server-logs',
        payload: {
          message: `➤ Crawling [${title}] → ${request.loadedUrl}`
        }
      })

      log.info(`✅ ${title}`, { url: request.loadedUrl })

      let docTextContent: string | null

      if (cssSelector) {
        await page.waitForSelector(cssSelector)
        docTextContent = await page.$eval(cssSelector, (el) => el.textContent)
      } else {
        docTextContent = await page.textContent('body') // If selector is not provided, extract all text from the page.
      }

      // Remove extra \n and spacess to save storage and tokens
      const cleanText = docTextContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ')

      // save data for further creating and storing embeddings
      saveData({ title, url: request.loadedUrl, text: cleanText })
    },
    headless: true,
    maxRequestsPerCrawl: maxPagesToCrawl,
    maxConcurrency: 1,
    maxRequestRetries: 2
  })

  try {
    await crawler.run([websiteUrl])
    projectChannel.send({
      type: 'broadcast',
      event: 'server-logs',
      payload: {
        message: `✅ Crawl completed
Requests failed: ${crawler.stats.state.requestsFailed}
Requests finished: ${crawler.stats.state.requestsFinished}`
      }
    })
    await crawler.requestQueue?.drop()

    projectChannel.send({
      type: 'broadcast',
      event: 'server-logs',
      payload: {
        message: `▻ Processing data into vector store...`
      }
    })
    await generateEmbeddings(data, {
      pineconeApiKey,
      pineconeEnvironment,
      pineconeIndexName,
      openaiApiKey,
      projectId,
      projectChannel
    })
    return { success: true, message: 'crawl completed' }
  } catch (error: any) {
    throw new Error(error.message)
    // return { success: false, error: 'Crawl: '+error.message }
  }
}
