// File: api/upload-image.js
// Handle image uploads and store in Notion

import { Client } from '@notionhq/client';
import formidable from 'formidable';
import fs from 'fs';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export const config = {
  api: {
    bodyParser: false, // Disable default body parser for file uploads
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse multipart form data
    const form = formidable({
      maxFileSize: 5 * 1024 * 1024, // 5MB limit
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);
    const recipeId = Array.isArray(fields.recipeId) ? fields.recipeId[0] : fields.recipeId;
    const imageFile = Array.isArray(files.image) ? files.image[0] : files.image;

    if (!imageFile) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    if (!recipeId) {
      return res.status(400).json({ error: 'Recipe ID is required' });
    }

    // Validate file type
    if (!imageFile.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'File must be an image' });
    }

    // Upload to a file hosting service or convert to base64
    const imageUrl = await uploadImageToService(imageFile);
    
    // Add image to Notion page
    await addImageToNotionPage(recipeId, imageUrl);

    return res.status(200).json({
      success: true,
      imageUrl: imageUrl,
      message: 'Image uploaded successfully'
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Upload failed'
    });
  }
}

async function uploadImageToService(imageFile) {
  // Option 1: Upload to a service like Cloudinary, AWS S3, etc.
  // For this example, we'll convert to base64 and use a data URL
  // In production, you should use a proper file hosting service
  
  try {
    // Read file as base64
    const fileBuffer = fs.readFileSync(imageFile.filepath);
    const base64 = fileBuffer.toString('base64');
    const mimeType = imageFile.mimetype;
    
    // For demo purposes, we'll use a placeholder image service
    // In production, replace this with actual file hosting
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    // If using a real service like Cloudinary:
    // const cloudinary = require('cloudinary').v2;
    // const result = await cloudinary.uploader.upload(imageFile.filepath);
    // return result.secure_url;
    
    // For now, return the data URL (Note: Notion has limits on data URLs)
    // You should implement proper file hosting for production use
    return await uploadToImageHost(fileBuffer, mimeType);
    
  } catch (error) {
    console.error('Image conversion error:', error);
    throw new Error('Failed to process image');
  }
}

async function uploadToImageHost(buffer, mimeType) {
  // Example using ImgBB (free image hosting)
  // Sign up at https://api.imgbb.com/ for API key
  
  if (process.env.IMGBB_API_KEY) {
    try {
      const base64 = buffer.toString('base64');
      const formData = new FormData();
      formData.append('image', base64);
      formData.append('key', process.env.IMGBB_API_KEY);
      
      const response = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success) {
        return result.data.url;
      } else {
        throw new Error('ImgBB upload failed');
      }
    } catch (error) {
      console.error('ImgBB upload error:', error);
    }
  }
  
  // Fallback: Use data URL (not recommended for production)
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

async function addImageToNotionPage(pageId, imageUrl) {
  try {
    // Check if page already has images to avoid duplicates
    const blocks = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 10
    });
    
    // Remove existing image blocks
    for (const block of blocks.results) {
      if (block.type === 'image') {
        await notion.blocks.delete({
          block_id: block.id
        });
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
    throw new Error('Failed to add image to Notion');
  }
}
