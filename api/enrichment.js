// Complete Recipe Enrichment System
// Supports both Vercel deployment and GitHub Actions

import { Client } from '@notionhq/client';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

// Configuration Constants
const CONFIG = {
  MAX_RECIPES_PER_BATCH: 5,
  DEFAULT_DATABASE_ID: "1b1ea313dfba4618915c4574ad7ed576",
  AI_DELAY_MS: 1000,
  MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
  TIMEOUT_MS: 30000 // 30 seconds
};

// Environment Variables
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_ID = process.env.NOTION_DATABASE_ID || CONFIG.DEFAULT_DATABASE_ID;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

// Initialize clients
const notion = new Client({ auth: NOTION_TOKEN });

// Recipe Options (shared with frontend)
const RECIPE_OPTIONS = {
  CUISINE: [
    "African", "American", "Asian", "Brazilian", "Chinese", "Dessert", 
    "French", "German", "Greek", "Hungarian", "Indian", "Italian", 
    "Japanese", "Korean", "Mediterranean", "Mexican", "Middle Eastern", 
    "Persian", "Peruvian", "Spanish", "Thai", "Vietnamese"
  ],
  
  MEAL: [
    "Main Dish", "Side Dish", "Breakfast", "Dessert", "Snack", "Beverage"
  ],
  
  TAGS: [
    "Appetizer", "Baked", "Braised", "Breakfast", "Chocolate", "Citrusy",
    "Condiment", "Creamy", "Curry", "Drink", "Eggs", "Fish", "Grilled",
    "Herby", "No Bake", "Pasta", "Pickled", "Refreshing", "Roasted",
    "Salad", "Sandwich", "Savory", "Seafood", "Soup", "Spicy", "Steamed",
    "Stew", "Stir-Fry", "Sweet", "Tangy", "Traditional", "Vegan", "Vegetarian"
  ],
  
  INGREDIENTS: [
    "Beef", "Chicken", "Pork", "Fish", "Salmon", "Shrimp", "Eggs", "Cheese",
    "Pasta", "Rice", "Bread", "Potato", "Tomato", "Onions", "Garlic",
    "Spinach", "Broccoli", "Carrot", "Mushrooms", "Peppers", "Lemon",
    "Basil", "Herbs", "Ginger", "Chili", "Beans", "Cream", "Milk"
  ]
};

// Legacy aliases for backward compatibility
const CUISINE_OPTIONS = RECIPE_OPTIONS.CUISINE;
const MEAL_OPTIONS = RECIPE_OPTIONS.MEAL;
const TAG_OPTIONS = RECIPE_OPTIONS.TAGS;
const INGREDIENT_OPTIONS = RECIPE_OPTIONS.INGREDIENTS;

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
        current_ingredients: page.properties['Key Ingredients']?.multi_select?.map(ing => ing.name) || [],
        // Page content will be loaded separately when needed
        current_page_content: null
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
        images: this.extractMainImage($), // Now returns array of images
        description: this.extractDescription($),
        servings: this.extractServings($),
        prepTime: this.extractPrepTime($),
        cookTime: this.extractCookTime($),
        totalTime: this.extractTotalTime($)
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
      $(selector).each((_, el) => {
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
      $(selector).each((_, el) => {
        const instruction = $(el).text().trim();
        if (instruction) instructions.push(instruction);
      });
      if (instructions.length > 0) break;
    }
    
    return instructions;
  }

  // Extract all images from page
  extractMainImage($) {
    const images = [];
    const seenUrls = new Set();
    
    // Priority selectors for recipe-specific images
    const prioritySelectors = [
      '.recipe-image img',
      '.post-thumbnail img',
      '.featured-image img',
      '.recipe-card img',
      'img[class*="recipe"]',
      '.wp-block-image img',
      '.entry-content img'
    ];
    
    // First, try priority selectors
    for (const selector of prioritySelectors) {
      $(selector).each((_, elem) => {
        const img = $(elem);
        const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
        
        if (src && this.isValidImageUrl(src) && !seenUrls.has(src)) {
          seenUrls.add(src);
          images.push({
            url: src,
            alt: img.attr('alt') || '',
            width: parseInt(img.attr('width')) || null,
            height: parseInt(img.attr('height')) || null,
            source: 'priority'
          });
        }
      });
    }
    
    // If we don't have many images, get all images from the page
    if (images.length < 5) {
      $('img').each((i, elem) => {
        const img = $(elem);
        const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
        
        if (src && this.isValidImageUrl(src) && !seenUrls.has(src)) {
          // Skip obviously non-recipe images
          const alt = (img.attr('alt') || '').toLowerCase();
          const srcLower = src.toLowerCase();
          
          // Skip common non-recipe images
          if (alt.includes('logo') || alt.includes('avatar') || alt.includes('profile') ||
              srcLower.includes('logo') || srcLower.includes('avatar') || 
              srcLower.includes('profile') || srcLower.includes('icon')) {
            return;
          }
          
          seenUrls.add(src);
          images.push({
            url: src,
            alt: img.attr('alt') || '',
            width: parseInt(img.attr('width')) || null,
            height: parseInt(img.attr('height')) || null,
            source: 'general'
          });
        }
      });
    }
    
    // Sort by priority (priority source first, then by size if available)
    images.sort((a, b) => {
      if (a.source === 'priority' && b.source !== 'priority') return -1;
      if (b.source === 'priority' && a.source !== 'priority') return 1;
      
      // Sort by size (larger images first)
      const aSize = (a.width || 0) * (a.height || 0);
      const bSize = (b.width || 0) * (b.height || 0);
      return bSize - aSize;
    });
    
    // Return array of images or null if none found
    return images.length > 0 ? images : null;
  }
  
  // Helper method to validate image URLs
  isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    // Must be HTTP/HTTPS
    if (!url.startsWith('http')) return false;
    
    // Should have image extension or be from common image domains
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i;
    const imageDomains = /\.(amazonaws\.com|cloudfront\.net|wp\.com|squarespace\.com|wixstatic\.com|imgbb\.com)/i;
    
    return imageExtensions.test(url) || imageDomains.test(url);
  }









  // Use AI to analyze and categorize recipe
  async analyzeRecipeWithAI(recipe, extractedData) {
    try {
      // Prepare context from extracted data
      const context = extractedData ? `
        Extracted Title: ${extractedData.title || 'N/A'}
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
          model: 'gpt-4o-mini',
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
    
    for (const recipe of recipes.slice(0, CONFIG.MAX_RECIPES_PER_BATCH)) {
      console.log(`Processing: ${recipe.name}`);
      
      // Check if recipe needs data extraction (data hierarchy logic)
      const needsExtraction = await this.needsDataExtraction(recipe);
      let extractedData = null;
      
      // Store page content in recipe for frontend use
      recipe.current_page_content = needsExtraction.pageContent;
      
      if (needsExtraction.needsAnyData) {
        console.log(`  → Web scraping needed for: ${needsExtraction.missingFields.join(', ')}`);
        extractedData = await this.extractRecipeFromURL(recipe.link);
        
        // Only extract the fields that are missing from Notion
        if (extractedData) {
          extractedData = this.filterExtractedData(extractedData, needsExtraction.missingFields);
        }
      } else {
        console.log(`  → Skipping web scraping - all essential data exists in Notion`);
      }
      
      // Get AI analysis (only if we have basic recipe info)
      const analysis = await this.analyzeRecipeWithAI(recipe, extractedData);
      
      if (analysis) {
        reviewItems.push({
          recipe,
          extractedData: extractedData ? this.filterExtractedData(extractedData, []) : { source: 'notion-only' },
          analysis,
          suggestedChanges: this.formatSuggestedChanges(recipe, analysis, extractedData)
        });
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return reviewItems;
  }

  // Load page content for a recipe
  async loadPageContent(pageId) {
    try {
      const response = await notion.blocks.children.list({
        block_id: pageId,
      });
      
      // Parse existing content to extract recipe data
      const content = {};
      
      for (const block of response.results) {
        if (block.type === 'paragraph' && block.paragraph?.rich_text?.[0]) {
          const text = block.paragraph.rich_text[0].plain_text;
          
          // Try to parse structured content
        }
      }
      
      return content;
    } catch (error) {
      console.error('Error loading page content:', error);
      return null;
    }
  }

  // Update page content with structured recipe data
  async updatePageContent(pageId, contentData) {
    // No longer updating page content - just database properties
    console.log(`Skipping page content update for ${pageId} - no content to save`);
    return true;
  }

  // Determine if web scraping is needed based on existing Notion data
  async needsDataExtraction(recipe) {
    const missingFields = [];
    
    // Load existing page content
    const pageContent = await this.loadPageContent(recipe.id);
    
    if (!pageContent) {
      // If we can't load page content, assume we need everything
      return {
        needsAnyData: true,
        missingFields: [],
        pageContent: null
      };
    }
    
    // Check for missing essential data fields
    
    
    return {
      needsAnyData: missingFields.length > 0,
      missingFields: missingFields,
      pageContent: pageContent
    };
  }

  // Filter extracted data to only include missing fields
  filterExtractedData(extractedData, missingFields) {
    const filtered = {};
    
    // Only include essential fields for UI purposes (no ingredients or instructions)
    if (extractedData.title) filtered.title = extractedData.title;
    if (extractedData.images) filtered.images = extractedData.images;
    if (extractedData.imageUrl) filtered.imageUrl = extractedData.imageUrl;
    
    return filtered;
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

  // Create review data with website refresh only (force re-scraping)
  async createReviewDataWithWebsiteRefresh(recipes) {
    const reviewItems = [];
    
    for (const recipe of recipes.slice(0, CONFIG.MAX_RECIPES_PER_BATCH)) {
      console.log(`Re-scraping website for: ${recipe.name}`);
      
      // Force fresh scraping from website
      const extractedData = await this.extractRecipeFromURL(recipe.link);
      
      // Use existing AI analysis if available, otherwise run new analysis
      let analysis;
      try {
        // Try to get cached analysis first, but fallback to fresh analysis
        analysis = await this.analyzeRecipeWithAI(recipe, extractedData);
      } catch (error) {
        console.log(`AI analysis failed for ${recipe.name}, using basic analysis`);
        analysis = this.createBasicAnalysis(extractedData);
      }
      
      if (analysis) {
        reviewItems.push({
          recipe,
          extractedData: this.filterExtractedData(extractedData, []),
          analysis,
          suggestedChanges: this.formatSuggestedChanges(recipe, analysis)
        });
      }
    }
    
    return reviewItems;
  }

  // Create review data with AI refresh only (re-run AI on existing scraped data)
  async createReviewDataWithAIRefresh(recipes) {
    const reviewItems = [];
    
    for (const recipe of recipes.slice(0, CONFIG.MAX_RECIPES_PER_BATCH)) {
      console.log(`Re-running AI analysis for: ${recipe.name}`);
      
      // Use cached scraped data if available, otherwise scrape fresh
      let extractedData = recipe.cachedExtractedData;
      if (!extractedData) {
        extractedData = await this.extractRecipeFromURL(recipe.link);
      }
      
      // Force fresh AI analysis
      const analysis = await this.analyzeRecipeWithAI(recipe, extractedData);
      
      if (analysis) {
        reviewItems.push({
          recipe,
          extractedData: this.filterExtractedData(extractedData, []),
          analysis,
          suggestedChanges: this.formatSuggestedChanges(recipe, analysis)
        });
      }
    }
    
    return reviewItems;
  }

  // Create basic analysis when AI fails
  createBasicAnalysis(extractedData) {
    return {
      meal: null,
      cuisine: null,
      tags: extractedData?.ingredients?.slice(0, 3) || [],
      key_ingredients: extractedData?.ingredients?.slice(0, 5) || [],
      confidence: 0.5,
      reasoning: "Basic analysis - AI processing was unavailable"
    };
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

// Validation utilities
function validateUpdateData(updates) {
  const allowedFields = ['title', 'meal', 'cuisine', 'tags', 'keyIngredients', 'selectedImage'];
  const validated = {};
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      validated[key] = sanitizeInput(value);
    }
  }
  
  return validated;
}

function sanitizeInput(input) {
  if (typeof input === 'string') {
    return input.trim().slice(0, 10000); // Limit string length
  }
  if (Array.isArray(input)) {
    return input.slice(0, 50).map(item => String(item).trim().slice(0, 100)); // Limit array size and item length
  }
  return input;
}

function validateRecipeId(recipeId) {
  if (!recipeId || typeof recipeId !== 'string' || recipeId.length < 10) {
    throw new Error('Invalid recipe ID');
  }
  return recipeId;
}

// For Vercel API route
export async function handler(req, res) {
  console.log('DEBUG - Handler called with method:', req.method);
  console.log('DEBUG - Request body exists:', !!req.body);
  console.log('DEBUG - Request body keys:', req.body ? Object.keys(req.body) : 'no body');
  
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
      // Environment check
      if (process.env.NODE_ENV === 'development') {
        console.log('DEBUG - Environment check:');
        console.log('  NOTION_TOKEN present:', !!NOTION_TOKEN);
        console.log('  DATABASE_ID present:', !!DATABASE_ID);
      }
      
      const refreshType = req.query.refresh || 'notion';
      console.log('Refresh type:', refreshType);
      
      let reviewData;
      
      if (refreshType === 'notion') {
        // Just get fresh data from Notion without re-scraping or re-analyzing
        const recipes = await enricher.getIncompleteRecipes();
        reviewData = await enricher.createReviewData(recipes);
        
      } else if (refreshType === 'website') {
        // Re-scrape website data but keep existing AI analysis
        const recipes = await enricher.getIncompleteRecipes();
        reviewData = await enricher.createReviewDataWithWebsiteRefresh(recipes);
        
      } else if (refreshType === 'ai') {
        // Re-run AI analysis on existing scraped data
        const recipes = await enricher.getIncompleteRecipes();
        reviewData = await enricher.createReviewDataWithAIRefresh(recipes);
        
      } else {
        // Default: full refresh (same as before)
        reviewData = await enricher.createReviewData(
          await enricher.getIncompleteRecipes()
        );
      }
      
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
      console.log('DEBUG - POST request body:', req.body);
      const { action, recipeId, updates } = req.body;
      console.log('DEBUG - Extracted values:', { action, recipeId, hasUpdates: !!updates, updateKeys: updates ? Object.keys(updates) : [] });
      
      if (action === 'updateRecipe' && recipeId && updates) {
        console.log('DEBUG - Entering updateRecipe logic');
        // Validate inputs
        const validatedRecipeId = validateRecipeId(recipeId);
        const validatedUpdates = validateUpdateData(updates);
        
        // Update individual recipe
        try {
          const properties = {};
          
          // Handle title update
          if (validatedUpdates.title) {
            properties.Name = {
              title: [{ text: { content: validatedUpdates.title } }]
            };
          }
          
          // Handle meal update
          if (validatedUpdates.meal) {
            properties.Meal = { select: { name: validatedUpdates.meal } };
          }
          
          // Handle cuisine update
          if (validatedUpdates.cuisine) {
            properties.Cuisine = { select: { name: validatedUpdates.cuisine } };
          }
          
          // Handle tags update
          if (validatedUpdates.tags && Array.isArray(validatedUpdates.tags)) {
            properties.Tags = {
              multi_select: validatedUpdates.tags.map(tag => ({ name: tag }))
            };
          }
          
          // Handle key ingredients update
          if (validatedUpdates.keyIngredients && Array.isArray(validatedUpdates.keyIngredients)) {
            properties['Key Ingredients'] = {
              multi_select: validatedUpdates.keyIngredients.map(ing => ({ name: ing }))
            };
          }
          
          
          // Handle image update
          if (validatedUpdates.selectedImage) {
            // Add the cover image to the page
            await notion.pages.update({
              page_id: validatedRecipeId,
              cover: {
                external: {
                  url: validatedUpdates.selectedImage
                }
              }
            });
          }
          
          // Update the page properties
          if (Object.keys(properties).length > 0) {
            await notion.pages.update({
              page_id: validatedRecipeId,
              properties
            });
          }
          
          return res.status(200).json({
            success: true,
            message: 'Recipe updated successfully'
          });
          
        } catch (error) {
          console.error('Error updating recipe:', error);
          return res.status(500).json({
            success: false,
            error: 'Failed to update recipe',
            details: error.message
          });
        }
        
      } else {
        // Run full enrichment process
        const result = await enricher.run();
        return res.status(200).json(result);
      }
      
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

// Default export for Vercel
export default handler;

// For GitHub Actions or direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const enricher = new RecipeEnrichmentSystem();
  enricher.run().catch(console.error);
}