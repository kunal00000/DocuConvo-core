import Bull from 'bull'
import { Request, Response } from 'express'

import { prisma } from '../lib/db.js'
import {
  AuthToken,
  REDIS_PASSWORD,
  REDIS_PORT,
  REDIS_URL
} from '../lib/config.js'
import { mailOptions, sendAlert } from '../lib/send-alert.js'
import { runCrawler } from '../main.js'

export const crawlQueue = new Bull('task', {
  redis: {
    password: REDIS_PASSWORD,
    host: REDIS_URL,
    port: REDIS_PORT
  }
})

export async function addToQueue(req: Request, res: Response) {
  const token = req.headers.authorization?.split(' ')[1] // Bearer <token>
  if (!token || token !== AuthToken) {
    return res.status(401).json({ success: false, message: 'Not authorized' })
  }

  try {
    const {
      websiteUrl,
      match,
      cssSelector,
      maxPagesToCrawl,
      pineconeApiKey,
      pineconeEnvironment,
      pineconeIndexName,
      openaiApiKey,
      projectId
    } = req.body
    await crawlQueue.add({
      websiteUrl,
      match,
      cssSelector,
      maxPagesToCrawl,
      pineconeApiKey,
      pineconeEnvironment,
      pineconeIndexName,
      openaiApiKey,
      projectId
    })

    console.log(
      'Added ' + websiteUrl + ' to queue at [' + new Date().toISOString() + ']'
    )

    return res
      .status(200)
      .json({ success: true, message: `successfully added to Queue` })
  } catch (error: any) {
    return res
      .status(400)
      .json({ success: false, message: 'Queue: ' + error.message })
  }
}

crawlQueue.process(async (job, done) => {
  try {
    console.log(
      'Processing job ' +
        job.data['websiteUrl'] +
        ' at [' +
        new Date().toISOString() +
        ']'
    )
    const { success, message } = await runCrawler(
      job.data['websiteUrl'],
      job.data['match'],
      job.data['cssSelector'],
      job.data['maxPagesToCrawl'],
      job.data['pineconeApiKey'],
      job.data['pineconeEnvironment'],
      job.data['pineconeIndexName'],
      job.data['openaiApiKey'],
      job.data['projectId']
    )

    sendAlert({
      ...mailOptions,
      subject: 'Docuconvo Alert - ✅ Crawl Successful',
      text: `Crawl successful for ${job.data['websiteUrl']} with success: ${success} and message: ${message}. Take further actions accordingly.`
    })
    await prisma.project.update({
      where: {
        id: job.data['projectId']
      },
      data: {
        status: 'created'
      }
    })
    done(null, { success, message })
  } catch (error: any) {
    sendAlert({
      ...mailOptions,
      subject: 'Docuconvo Alert - ❌ Crawl Failed',
      text: `Crawl failed for ${job.data['websiteUrl']} with error: ${error.message}. Take further actions accordingly.`
    })
    done(error.message, { success: false, message: error.message })
  }
})
