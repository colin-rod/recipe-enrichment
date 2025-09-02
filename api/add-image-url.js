// File: api/add-image-url.js
// Handle adding images from URLs to Notion

import { Client } from '@notionhq/client';
import fetch from 'node-fetch';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { recipeId, imageUrl } = req.body;

    if (!recipeId) {
        return res.status(400).json({ error: 'Recipe ID is required' });
    }

    if (!imageUrl) {
        return res.status(400).json({ error: 'Image URL is required' });
    }

    try {
        // Validate URL format
        if (!isValidImageUrl(imageUrl)) {
            return res.status(400).json({ error: 'Invalid image URL format' });
        }

        // Test if image URL is accessible
        const isAccessible = await testImageUrl(imageUrl);
        if (!isAccessible) {
            return res.status(400).json({ error: 'Image URL is not accessible or not a valid image' });
        }

        // Add image to Notion page
        await addImageToNotionPage(recipeId, imageUrl);

        return res.status(200).json({
            success: true,
            imageUrl: imageUrl,
            message: 'Image URL added successfully'
        });

    } catch (error) {
        console.error('Add image URL error:', error);
        
        let errorMessage = 'Failed to add image';
        
        if (error.code === 'object_not_found') {
            errorMessage = 'Recipe not found in Notion';
        } else if (error.message.includes('invalid_url')) {
            errorMessage = 'Invalid image URL - Notion could not load the image';
        } else if (error.message.includes('file_size_exceeded')) {
            errorMessage = 'Image file too large';
        }
        
        return res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
}

function isValidImageUrl(url) {
    try {
        const urlObj = new URL(url);
        
        // Check if it's HTTP/HTTPS
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return false;
        }
        
        // Basic domain validation
        if (!urlObj.hostname || urlObj.hostname.length < 3) {
            return false;
        }
        
        return true;
        
    } catch (error) {
        return false;
    }
}

async function testImageUrl(imageUrl) {
    try {
        // Test with a HEAD request to avoid downloading the full image
        const response = await fetch(imageUrl, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)'
            },
            timeout: 10000
        });
        
        if (!response.ok) {
            // If HEAD fails, try GET with range to get just the first few bytes
            const getResponse = await fetch(imageUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
                    'Range': 'bytes=0-1023' // First 1KB
                },
                timeout: 10000
            });
            
            if (!getResponse.ok) {
                return false;
            }
            
            // Check content type from the actual response
            const contentType = getResponse.headers.get('content-type');
            return contentType && contentType.startsWith('image/');
        }
        
        // Check content type from HEAD response
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.startsWith('image/')) {
            return true;
        }
        
        // Some servers don't return content-type in HEAD, so we'll allow it
        // Notion will validate the actual image when we try to add it
        return true;
        
    } catch (error) {
        console.error('Image URL test error:', error);
        return false;
    }
}

async function addImageToNotionPage(pageId, imageUrl) {
    try {
        // Remove existing image blocks first
        const blocks = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 50
        });
        
        const imageBlocks = blocks.results.filter(block => block.type === 'image');
        
        for (const block of imageBlocks) {
            try {
                await notion.blocks.delete({
                    block_id: block.id
                });
            } catch (deleteError) {
                console.warn('Could not delete existing image block:', deleteError);
            }
        }
        
        // Add new image block
        await notion.blocks.children.append({
            block_id: pageId,
            children: [
                {
                    type: 'image',
                    image: {
                        type: 'external',
                        external: {
                            url: imageUrl
                        }
                    }
                }
            ]
        });
        
    } catch (error) {
        console.error('Error adding image to Notion:', error);
        
        if (error.message && error.message.includes('invalid_url')) {
            throw new Error('invalid_url');
        }
        
        throw new Error('Failed to add image to Notion page');
    }
}