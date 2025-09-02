// Complete Recipe Enrichment System
// Supports both Vercel deployment and GitHub Actions

import { Client } from '@notionhq/client';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import nodemailer from 'nodemailer';

// Configuration
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_ID = "1b1ea313dfba4618915c4574ad7ed576";
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

// Initialize clients
const notion = new Client({ auth: NOTION_TOKEN });

// Enhanced options based on your schema (removed Source and Altered)
const CUISINE_OPTIONS = [
  "African", "American", "Asian", "Brazilian", "Chinese", "Dessert", 
  "French", "German", "Greek", "Hungarian", "Indian", "Italian", 
  "Japanese", "Korean", "Mediterranean", "Mexican", "Middle Eastern", 
  "Persian", "Peruvian", "Spanish", "Thai", "Vietnamese"
];

const MEAL_OPTIONS = [
  "Main Dish", "Side Dish", "Breakfast", "Dessert", "Snack", "Beverage"
];

const TAG_OPTIONS = [
  "Appetizer", "Baked", "Braised", "Breakfast", "Chocolate", "Citrusy",
  "Condiment", "Creamy", "Curry", "Drink", "Eggs", "Fish", "Grilled",
  "Herby", "No Bake", "Pasta", "Pickled", "Refreshing", "Roasted",
  "Salad", "Sandwich", "Savory", "Seafood", "Soup", "Spicy", "Steamed",
  "Stew", "Stir-Fry", "Sweet", "Tangy", "Traditional", "Vegan", "Vegetarian"
];

const INGREDIENT_OPTIONS = [
  "Beef", "Chicken", "Pork", "Fish", "Salmon", "Shrimp", "Eggs", "Cheese",
  "Pasta", "Rice", "Bread", "Potato", "Tomato", "Onions", "Garlic",
  "Spinach", "Broccoli", "Carrot", "Mushrooms", "Peppers", "Lemon",
  "Basil", "Herbs", "Ginger", "Chili", "Beans", "Cream", "Milk"
];

class RecipeEnrichmentSystem {
  constructor() {
    this.emailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });
  }

  // Get incomplete recipes from Notion
  async getIncompleteRecipes() {
    try {
      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          or: [
            { property: "Meal", select: { is_empty: true } },
            { property: "Cuisine", select: { is_empty: true } },
            { property: "Key Ingredients", multi_select: { is_empty: true } },
            { property: "Tags", multi_select: { is_empty: true } }
          ]
        }
      });

      const recipes = response.results.map(page => ({
        id: page.id,
        url: page.url,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        link: page.properties.Link?.url || '',
        current_meal: page.properties.Meal?.select?.name,
        current_cuisine: page.properties.Cuisine?.select?.name,
        current_tags: page.properties.Tags?.multi_select?.map(tag => tag.name) || [],
        current_ingredients: page.properties['Key Ingredients']?.multi_select?.map(ing => ing.name) || []
      }));

      console.log(`Found ${recipes.length} recipes needing enrichment`);
      return recipes;
    } catch (error) {
      console.error('Error fetching recipes:', error);
      return [];
    }
  }

  // Extract recipe data from source URL
  async extractRecipeFromURL(url) {
    if (!url) return null;
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
        }
      });
      
      if (!response.ok) {
        console.log(`Failed to fetch ${url}: ${response.status}`);
        return null;
      }
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Extract recipe data using multiple strategies
      const recipeData = {
        title: this.extractTitle($),
        ingredients: this.extractIngredients($),
        instructions: this.extractInstructions($),
        imageUrl: this.extractMainImage($),
        description: this.extractDescription($)
      };
      
      return recipeData;
    } catch (error) {
      console.error(`Error extracting from ${url}:`, error);
      return null;
    }
  }

  // Extract title with standardization
  extractTitle($) {
    // Try multiple selectors for title
    const titleSelectors = [
      'h1.recipe-title',
      'h1[class*="recipe"]',
      '.entry-title',
      'h1.post-title',
      'h1',
      'title'
    ];
    
    for (const selector of titleSelectors) {
      const title = $(selector).first().text().trim();
      if (title && title.length > 3) {
        return this.standardizeTitle(title);
      }
    }
    
    return null;
  }

  // Standardize title format
  standardizeTitle(title) {
    // Remove common suffixes and prefixes
    title = title
      .replace(/\s*\|\s*.+$/, '') // Remove "| Site Name"
      .replace(/Recipe\s*$/i, '') // Remove trailing "Recipe"
      .replace(/^\s*Recipe:\s*/i, '') // Remove leading "Recipe:"
      .replace(/\s*-\s*.+$/, '') // Remove "- Site Name"
      .trim();
    
    // Ensure proper capitalization
    return title.split(' ')
      .map(word => {
        // Don't capitalize common prepositions and articles unless first word
        const lowercaseWords = ['with', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'the', 'a', 'an'];
        if (lowercaseWords.includes(word.toLowerCase())) {
          return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ')
      .replace(/^./, c => c.toUpperCase()); // Ensure first character is uppercase
  }

  // Extract ingredients
  extractIngredients($) {
    const ingredientSelectors = [
      '.recipe-ingredient',
      '.ingredients li',
      '[class*="ingredient"] li',
      '.recipe-ingredients li'
    ];
    
    const ingredients = [];
    for (const selector of ingredientSelectors) {
      $(selector).each((i, el) => {
        const ingredient = $(el).text().trim();
        if (ingredient) ingredients.push(ingredient);
      });
      if (ingredients.length > 0) break;
    }
    
    return ingredients;
  }

  // Extract instructions
  extractInstructions($) {
    const instructionSelectors = [
      '.recipe-instruction',
      '.instructions li',
      '.directions li',
      '[class*="instruction"] li'
    ];
    
    const instructions = [];
    for (const selector of instructionSelectors) {
      $(selector).each((i, el) => {
        const instruction = $(el).text().trim();
        if (instruction) instructions.push(instruction);
      });
      if (instructions.length > 0) break;
    }
    
    return instructions;
  }

  // Extract main image
  extractMainImage($) {
    const imageSelectors = [
      '.recipe-image img',
      '.post-thumbnail img',
      '.featured-image img',
      '.recipe-card img',
      'img[class*="recipe"]'
    ];
    
    for (const selector of imageSelectors) {
      const img = $(selector).first();
      if (img.length) {
        const src = img.attr('src') || img.attr('data-src');
        if (src && src.startsWith('http')) {
          return src;
        }
      }
    }
    
    return null;
  }

  // Extract description
  extractDescription($) {
    const descSelectors = [
      '.recipe-description',
      '.recipe-summary',
      '.entry-content p',
      '.post-content p'
    ];
    
    for (const selector of descSelectors) {
      const desc = $(selector).first().text().trim();
      if (desc && desc.length > 50) {
        return desc.substring(0, 300) + '...';
      }
    }
    
    return null;
  }

  // Use AI to analyze and categorize recipe
  async analyzeRecipeWithAI(recipe, extractedData) {
    try {
      // Prepare context from extracted data
      const context = extractedData ? `
        Extracted Title: ${extractedData.title || 'N/A'}
        Description: ${extractedData.description || 'N/A'}
        Sample Ingredients: ${extractedData.ingredients?.slice(0, 10).join(', ') || 'N/A'}
      ` : 'No extracted data available';

      const prompt = `
      Analyze this recipe and provide enrichment data:
      
      Recipe Name: ${recipe.name}
      Source Link: ${recipe.link || 'No link'}
      ${context}
      
      Current Data (preserve if exists):
      - Meal Type: ${recipe.current_meal || 'Not set'}
      - Cuisine: ${recipe.current_cuisine || 'Not set'}
      - Tags: ${recipe.current_tags?.join(', ') || 'None'}
      - Key Ingredients: ${recipe.current_ingredients?.join(', ') || 'None'}
      
      RULES:
      1. Only suggest values for MISSING fields
      2. If current data exists, keep it unchanged
      3. Choose from EXACT options provided
      4. Suggest standardized title if current title needs improvement
      
      Available Options:
      - MEAL TYPES: ${MEAL_OPTIONS.join(', ')}
      - CUISINES: ${CUISINE_OPTIONS.join(', ')}
      - TAGS: ${TAG_OPTIONS.join(', ')}
      - KEY INGREDIENTS: ${INGREDIENT_OPTIONS.join(', ')}
      
      Respond with ONLY valid JSON:
      {
        "standardized_title": "improved title if needed, or null",
        "meal": "chosen_meal_type or null if exists",
        "cuisine": "chosen_cuisine or null if exists", 
        "tags": ["tag1", "tag2"] or null if exists,
        "key_ingredients": ["ingredient1", "ingredient2"] or null if exists,
        "confidence": 0.85,
        "reasoning": "Brief explanation"
      }
      `;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      let aiContent = data.choices[0].message.content.trim();
      
      // Clean up response
      if (aiContent.includes('```')) {
        aiContent = aiContent.replace(/```json\n?/, '').replace(/```\n?/, '');
      }
      
      const analysis = JSON.parse(aiContent);
      return this.validateAnalysis(analysis, recipe);
      
    } catch (error) {
      console.error(`Error analyzing recipe ${recipe.name}:`, error);
      return null;
    }
  }

  // Validate AI analysis against available options
  validateAnalysis(analysis, recipe) {
    // Preserve existing data
    if (recipe.current_meal) analysis.meal = null;
    if (recipe.current_cuisine) analysis.cuisine = null;
    if (recipe.current_tags?.length > 0) analysis.tags = null;
    if (recipe.current_ingredients?.length > 0) analysis.key_ingredients = null;
    
    // Validate against available options
    if (analysis.meal && !MEAL_OPTIONS.includes(analysis.meal)) {
      analysis.meal = "Main Dish"; // Default fallback
    }
    
    if (analysis.cuisine && !CUISINE_OPTIONS.includes(analysis.cuisine)) {
      analysis.cuisine = "American"; // Default fallback
    }
    
    if (analysis.tags) {
      analysis.tags = analysis.tags.filter(tag => TAG_OPTIONS.includes(tag));
    }
    
    if (analysis.key_ingredients) {
      analysis.key_ingredients = analysis.key_ingredients.filter(ing => 
        INGREDIENT_OPTIONS.includes(ing)
      );
    }
    
    return analysis;
  }

  // Create review interface data
  async createReviewData(recipes) {
    const reviewItems = [];
    
    for (const recipe of recipes.slice(0, 10)) { // Process 10 recipes per week
      console.log(`Processing: ${recipe.name}`);
      
      // Extract data from source
      const extractedData = await this.extractRecipeFromURL(recipe.link);
      
      // Get AI analysis
      const analysis = await this.analyzeRecipeWithAI(recipe, extractedData);
      
      if (analysis) {
        reviewItems.push({
          recipe,
          extractedData,
          analysis,
          suggestedChanges: this.formatSuggestedChanges(recipe, analysis, extractedData)
        });
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return reviewItems;
  }

  // Format suggested changes for review
  formatSuggestedChanges(recipe, analysis, extractedData) {
    const changes = {};
    
    if (analysis.standardized_title && analysis.standardized_title !== recipe.name) {
      changes.title = {
        current: recipe.name,
        suggested: analysis.standardized_title
      };
    }
    
    if (analysis.meal && !recipe.current_meal) {
      changes.meal = {
        current: 'Empty',
        suggested: analysis.meal
      };
    }
    
    if (analysis.cuisine && !recipe.current_cuisine) {
      changes.cuisine = {
        current: 'Empty',
        suggested: analysis.cuisine
      };
    }
    
    if (analysis.tags && (!recipe.current_tags || recipe.current_tags.length === 0)) {
      changes.tags = {
        current: recipe.current_tags || [],
        suggested: analysis.tags
      };
    }
    
    if (analysis.key_ingredients && (!recipe.current_ingredients || recipe.current_ingredients.length === 0)) {
      changes.key_ingredients = {
        current: recipe.current_ingredients || [],
        suggested: analysis.key_ingredients
      };
    }
    
    if (extractedData?.imageUrl) {
      changes.image = {
        current: 'No image',
        suggested: extractedData.imageUrl
      };
    }
    
    return changes;
  }

  // Apply approved changes to Notion
  async applyChangesToNotion(recipeId, changes) {
    try {
      const properties = {};
      
      if (changes.title?.apply) {
        properties.Name = {
          title: [{ text: { content: changes.title.suggested } }]
        };
      }
      
      if (changes.meal?.apply) {
        properties.Meal = { select: { name: changes.meal.suggested } };
      }
      
      if (changes.cuisine?.apply) {
        properties.Cuisine = { select: { name: changes.cuisine.suggested } };
      }
      
      if (changes.tags?.apply) {
        properties.Tags = {
          multi_select: changes.tags.suggested.map(tag => ({ name: tag }))
        };
      }
      
      if (changes.key_ingredients?.apply) {
        properties['Key Ingredients'] = {
          multi_select: changes.key_ingredients.suggested.map(ing => ({ name: ing }))
        };
      }
      
      // Update the page
      await notion.pages.update({
        page_id: recipeId,
        properties
      });
      
      // Add image if suggested and approved
      if (changes.image?.apply && changes.image.suggested) {
        await this.addImageToPage(recipeId, changes.image.suggested);
      }
      
      return true;
    } catch (error) {
      console.error(`Error updating recipe ${recipeId}:`, error);
      return false;
    }
  }

  // Add image to Notion page
  async addImageToPage(pageId, imageUrl) {
    try {
      await notion.blocks.children.append({
        block_id: pageId,
        children: [
          {
            type: 'image',
            image: {
              type: 'external',
              external: { url: imageUrl }
            }
          }
        ]
      });
    } catch (error) {
      console.error('Error adding image:', error);
    }
  }

  // Generate HTML email with review interface
  generateReviewEmail(reviewItems) {
    const recipesHtml = reviewItems.map(item => {
      const changesHtml = Object.entries(item.suggestedChanges)
        .map(([field, change]) => `
          <div class="change-item">
            <h4>${field.replace('_', ' ').toUpperCase()}</h4>
            <p><strong>Current:</strong> ${Array.isArray(change.current) ? change.current.join(', ') || 'Empty' : change.current}</p>
            <p><strong>Suggested:</strong> ${Array.isArray(change.suggested) ? change.suggested.join(', ') : change.suggested}</p>
          </div>
        `).join('');

      return `
        <div class="recipe-review" style="margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h3>${item.recipe.name}</h3>
          <p><strong>Source:</strong> <a href="${item.recipe.link}">${item.recipe.link}</a></p>
          <p><strong>Confidence:</strong> ${(item.analysis.confidence * 100).toFixed(0)}%</p>
          <p><strong>Reasoning:</strong> ${item.analysis.reasoning}</p>
          
          <div class="suggested-changes">
            <h4>Suggested Changes:</h4>
            ${changesHtml || '<p>No changes suggested</p>'}
          </div>
          
          ${item.extractedData?.imageUrl ? `
            <div class="extracted-image">
              <h4>Found Image:</h4>
              <img src="${item.extractedData.imageUrl}" style="max-width: 200px; border-radius: 4px;" alt="Recipe image">
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Weekly Recipe Review</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
          .change-item { margin: 10px 0; padding: 10px; background: #f1f3f4; border-radius: 4px; }
          .stats { background: #e8f5e8; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🍽️ Weekly Recipe Review</h1>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
        
        <div class="stats">
          <h3>📊 Summary</h3>
          <p><strong>Recipes Processed:</strong> ${reviewItems.length}</p>
          <p><strong>Total Suggestions:</strong> ${reviewItems.reduce((sum, item) => sum + Object.keys(item.suggestedChanges).length, 0)}</p>
          <p><strong>Images Found:</strong> ${reviewItems.filter(item => item.extractedData?.imageUrl).length}</p>
        </div>
        
        <div class="recipes">
          ${recipesHtml}
        </div>
        
        <div class="footer" style="margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
          <p><strong>Next Steps:</strong></p>
          <ol>
            <li>Review the suggestions above</li>
            <li>Visit your Notion database to manually apply desired changes</li>
            <li>The system will automatically skip updated recipes in future runs</li>
          </ol>
          <p><em>This automated review helps maintain your recipe database quality and consistency.</em></p>
        </div>
      </body>
      </html>
    `;
  }

  // Send email notification
  async sendEmailNotification(reviewItems) {
    try {
      const htmlContent = this.generateReviewEmail(reviewItems);
      
      await this.emailTransporter.sendMail({
        from: EMAIL_USER,
        to: RECIPIENT_EMAIL,
        subject: `🍽️ Weekly Recipe Review - ${reviewItems.length} recipes processed`,
        html: htmlContent
      });
      
      console.log('Email notification sent successfully');
    } catch (error) {
      console.error('Error sending email:', error);
    }
  }

  // Main execution function
  async run() {
    console.log('Starting weekly recipe enrichment...');
    
    try {
      // Get incomplete recipes
      const recipes = await this.getIncompleteRecipes();
      
      if (recipes.length === 0) {
        console.log('No recipes need enrichment');
        await this.sendEmailNotification([]);
        return;
      }
      
      // Create review data
      const reviewItems = await this.createReviewData(recipes);
      
      // Send email with review interface
      await this.sendEmailNotification(reviewItems);
      
      console.log(`Weekly enrichment completed! Processed ${reviewItems.length} recipes`);
      
      return {
        success: true,
        processed: reviewItems.length,
        total: recipes.length
      };
      
    } catch (error) {
      console.error('Error in main execution:', error);
      
      // Send error notification
      await this.emailTransporter.sendMail({
        from: EMAIL_USER,
        to: RECIPIENT_EMAIL,
        subject: '❌ Recipe Enrichment Error',
        text: `An error occurred during recipe enrichment: ${error.message}`
      });
      
      throw error;
    }
  }
}

// Export for different deployment platforms
export default RecipeEnrichmentSystem;

// For Vercel API route
export async function handler(req, res) {
  const enricher = new RecipeEnrichmentSystem();
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    if (req.method === 'GET') {
      // Return existing enrichment data for frontend display
      const reviewData = await enricher.createReviewData(
        await enricher.getIncompleteRecipes()
      );
      
      const stats = {
        totalRecipes: reviewData.length,
        totalSuggestions: reviewData.reduce((sum, item) => {
          return sum + Object.keys(item.suggestedChanges).length;
        }, 0),
        imagesFound: reviewData.filter(item => item.extractedData?.imageUrl).length,
        avgConfidence: reviewData.length > 0 
          ? reviewData.reduce((sum, item) => sum + item.analysis.confidence, 0) / reviewData.length 
          : 0
      };
      
      return res.status(200).json({
        success: true,
        data: reviewData,
        stats: stats
      });
      
    } else if (req.method === 'POST') {
      // Run full enrichment process
      const result = await enricher.run();
      return res.status(200).json(result);
      
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// For GitHub Actions or direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const enricher = new RecipeEnrichmentSystem();
  enricher.run().catch(console.error);
}