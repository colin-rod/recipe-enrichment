// Simple Notion connection test
import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = "1b1ea313dfba4618915c4574ad7ed576";

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Check environment variables
    if (!NOTION_TOKEN) {
      return res.status(500).json({ 
        error: 'Missing NOTION_TOKEN environment variable',
        hasToken: false 
      });
    }

    // Initialize Notion client
    const notion = new Client({ auth: NOTION_TOKEN });
    
    console.log('Testing Notion connection...');
    
    // Test basic connection with simple query
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      page_size: 5 // Just get 5 recipes for testing
    });

    const recipes = response.results.map(page => ({
      id: page.id,
      name: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
      link: page.properties.Link?.url || 'No link',
      meal: page.properties.Meal?.select?.name || 'Not set',
      cuisine: page.properties.Cuisine?.select?.name || 'Not set',
      tags: page.properties.Tags?.multi_select?.map(tag => tag.name) || [],
      ingredients: page.properties['Key Ingredients']?.multi_select?.map(ing => ing.name) || []
    }));

    return res.status(200).json({
      success: true,
      message: 'Notion connection successful!',
      data: {
        totalFound: response.results.length,
        hasToken: true,
        databaseId: DATABASE_ID,
        recipes: recipes
      }
    });

  } catch (error) {
    console.error('Notion test error:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      hasToken: !!NOTION_TOKEN,
      databaseId: DATABASE_ID,
      details: process.env.NODE_ENV === 'development' ? error.stack : 'Error details hidden in production'
    });
  }
}