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
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''

export const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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

    const projectChannel = client.channel(projectId)
    projectChannel.send({
      type: 'broadcast',
      event: 'server-logs',
      payload: {
        message: `➤ Added [${websiteUrl}] to Queue.`
      }
    })

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
  const projectChannel = client.channel(job.data['projectId'])
  try {
    projectChannel.send({
      type: 'broadcast',
      event: 'server-logs',
      payload: {
        message: `▻ Starting crawl...`
      }
    })

    const { success, message } = await runCrawler(
      job.data['websiteUrl'],
      job.data['match'],
      job.data['cssSelector'],
      job.data['maxPagesToCrawl'],
      job.data['pineconeApiKey'],
      job.data['pineconeEnvironment'],
      job.data['pineconeIndexName'],
      job.data['openaiApiKey'],
      job.data['projectId'],
      projectChannel
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

    projectChannel.send({
      type: 'broadcast',
      event: 'server-logs',
      payload: {
        message: `🎉 You are all set to connect DocuConvo.`
      }
    })
    done(null, { success, message })
  } catch (error: any) {
    sendAlert({
      ...mailOptions,
      subject: 'Docuconvo Alert - ❌ Crawl Failed',
      text: `Crawl failed for ${job.data['websiteUrl']} with error: ${error.message}. Take further actions accordingly.`
    })

    projectChannel.send({
      type: 'broadcast',
      event: 'server-logs',
      payload: {
        message: `❌ An error occurred: ${error.message}. `
      }
    })
    done(error.message, { success: false, message: error.message })
  }
})
