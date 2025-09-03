// Complete Recipe Enrichment System - Vercel Compatible
// Supports both Vercel deployment and GitHub Actions

import { Client } from '@notionhq/client';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import nodemailer from 'nodemailer';

// Configuration Constants
const CONFIG = {
  MAX_RECIPES_PER_BATCH: 5,
  DEFAULT_DATABASE_ID: "1b1ea313dfba4618915c4574ad7ed576",
  AI_DELAY_MS: 1000,
  MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
  TIMEOUT_MS: 30000 // 30 seconds
};

// Environment Variables - with fallbacks for debugging
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DATABASE_ID = process.env.NOTION_DATABASE_ID || CONFIG.DEFAULT_DATABASE_ID;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

// Check required environment variables
if (!NOTION_TOKEN) {
  console.error('Missing NOTION_TOKEN environment variable');
}
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY environment variable');
}

// Initialize clients
let notion;
try {
  notion = new Client({ auth: NOTION_TOKEN });
} catch (error) {
  console.error('Failed to initialize Notion client:', error.message);
}

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
    if (EMAIL_USER && EMAIL_PASS) {
      this.emailTransporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          user: EMAIL_USER,
          pass: EMAIL_PASS
        }
      });
    }
  }

  // Get incomplete recipes from Notion
  async getIncompleteRecipes() {
    try {
      if (!notion) {
        throw new Error('Notion client not initialized');
      }

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

      return recipes;

    } catch (error) {
      console.error('Error fetching recipes from Notion:', error);
      throw new Error(`Failed to fetch recipes: ${error.message}`);
    }
  }

  // Simplified create review data method
  async createReviewData(recipes) {
    const reviewItems = [];
    
    for (const recipe of recipes.slice(0, CONFIG.MAX_RECIPES_PER_BATCH)) {
      try {
        // Create basic analysis without external API calls for now
        const analysis = this.createBasicAnalysis(recipe);
        
        if (analysis) {
          reviewItems.push({
            recipe,
            extractedData: { source: 'notion-only' },
            analysis,
            suggestedChanges: this.formatSuggestedChanges(recipe, analysis)
          });
        }
      } catch (error) {
        console.error(`Error processing recipe ${recipe.name}:`, error);
        // Continue with other recipes
      }
    }
    
    return reviewItems;
  }

  // Create basic analysis when AI fails or for testing
  createBasicAnalysis(recipe) {
    // Simple rule-based analysis
    let meal = null;
    let cuisine = null;
    let tags = [];
    let key_ingredients = [];

    // Basic name-based inference
    const name = recipe.name.toLowerCase();
    
    // Infer meal type
    if (name.includes('breakfast') || name.includes('pancake') || name.includes('oatmeal')) {
      meal = 'Breakfast';
    } else if (name.includes('dessert') || name.includes('cake') || name.includes('cookie')) {
      meal = 'Dessert';
    } else if (name.includes('salad') || name.includes('side')) {
      meal = 'Side Dish';
    } else {
      meal = 'Main Dish';
    }

    // Infer cuisine
    if (name.includes('italian') || name.includes('pasta') || name.includes('pizza')) {
      cuisine = 'Italian';
    } else if (name.includes('mexican') || name.includes('taco') || name.includes('burrito')) {
      cuisine = 'Mexican';
    } else if (name.includes('chinese') || name.includes('stir fry')) {
      cuisine = 'Chinese';
    } else if (name.includes('indian') || name.includes('curry')) {
      cuisine = 'Indian';
    }

    return {
      standardized_title: null, // Don't change existing titles
      meal: recipe.current_meal ? null : meal,
      cuisine: recipe.current_cuisine ? null : cuisine,
      tags: recipe.current_tags?.length > 0 ? null : tags,
      key_ingredients: recipe.current_ingredients?.length > 0 ? null : key_ingredients,
      confidence: 0.5,
      reasoning: "Basic rule-based analysis - AI processing not available"
    };
  }

  // Format suggested changes for review
  formatSuggestedChanges(recipe, analysis) {
    const changes = {};
    
    // Only suggest changes for empty/missing fields
    if (!recipe.current_meal && analysis.meal) {
      changes.meal = {
        current: recipe.current_meal || 'Empty',
        suggested: analysis.meal
      };
    }
    
    if (!recipe.current_cuisine && analysis.cuisine) {
      changes.cuisine = {
        current: recipe.current_cuisine || 'Empty',
        suggested: analysis.cuisine
      };
    }
    
    if ((!recipe.current_tags || recipe.current_tags.length === 0) && analysis.tags && analysis.tags.length > 0) {
      changes.tags = {
        current: recipe.current_tags || [],
        suggested: analysis.tags
      };
    }
    
    if ((!recipe.current_ingredients || recipe.current_ingredients.length === 0) && analysis.key_ingredients && analysis.key_ingredients.length > 0) {
      changes.key_ingredients = {
        current: recipe.current_ingredients || [],
        suggested: analysis.key_ingredients
      };
    }
    
    if (analysis.standardized_title && analysis.standardized_title !== recipe.name) {
      changes.title = {
        current: recipe.name,
        suggested: analysis.standardized_title
      };
    }
    
    return changes;
  }
}

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

// Main API handler for Vercel
export default async function handler(req, res) {
  // Set CORS headers first
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Environment validation
    if (!NOTION_TOKEN || !DATABASE_ID) {
      return res.status(500).json({
        success: false,
        error: 'Missing required environment variables',
        details: {
          hasNotionToken: !!NOTION_TOKEN,
          hasDatabaseId: !!DATABASE_ID
        }
      });
    }

    const enricher = new RecipeEnrichmentSystem();
    
    if (req.method === 'GET') {
      const refreshType = req.query.refresh || 'notion';
      
      // Get recipes from Notion
      const recipes = await enricher.getIncompleteRecipes();
      const reviewData = await enricher.createReviewData(recipes);
      
      const stats = {
        totalRecipes: reviewData.length,
        totalSuggestions: reviewData.reduce((sum, item) => {
          return sum + Object.keys(item.suggestedChanges).length;
        }, 0),
        imagesFound: 0,
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
      const { action, recipeId, updates } = req.body || {};
      
      if (action === 'updateRecipe' && recipeId && updates) {
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
        return res.status(400).json({
          success: false,
          error: 'Invalid request format'
        });
      }
      
    } else {
      return res.status(405).json({ 
        success: false,
        error: 'Method not allowed' 
      });
    }
    
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : 'Internal server error'
    });
  }
}