// Demo endpoint with the successful enrichment results from local testing
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Static data from our successful local test
  const demoReviewData = [
    {
      recipe: {
        id: "demo-1",
        url: "https://notion.so/demo-1",
        name: "Potatoes au Gratin (Dauphinoise) - RecipeTin Eats",
        link: "https://www.recipetineats.com/potatoes-au-gratin/#recipe",
        current_meal: null,
        current_cuisine: null,
        current_tags: [],
        current_ingredients: []
      },
      analysis: {
        standardized_title: "Potatoes au Gratin (Dauphinoise)",
        meal: "Side Dish",
        cuisine: "French",
        tags: ["Baked", "Creamy", "Traditional"],
        key_ingredients: ["Potato", "Cream", "Garlic"],
        confidence: 0.95,
        reasoning: "The recipe is a traditional French dish often served as a side. It involves baking and has a creamy texture due to the use of cream. The key ingredients are potatoes, cream, and garlic."
      },
      extractedData: {
        title: "Potatoes au Gratin (Dauphinoise)",
        description: "Potatoes au Gratin is the ultimate potato recipe! French classic with layers of thinly sliced potato...",
        ingredients: ["potatoes", "heavy cream", "garlic", "thyme", "butter", "salt", "pepper"]
      },
      suggestedChanges: {
        meal: { from: "Empty", to: "Side Dish" },
        cuisine: { from: "Empty", to: "French" },
        tags: { from: "Empty", to: ["Baked", "Creamy", "Traditional"] },
        key_ingredients: { from: "Empty", to: ["Potato", "Cream", "Garlic"] }
      }
    },
    {
      recipe: {
        id: "demo-2",
        url: "https://notion.so/demo-2", 
        name: "Chicken 65 Recipe | Restaurant Style - Swasthi's Recipes",
        link: "https://www.indianhealthyrecipes.com/chicken-65-recipe-no-egg-restaurant-style-chicken-recipes/#wprm-recipe-container-38252",
        current_meal: null,
        current_cuisine: null,
        current_tags: [],
        current_ingredients: []
      },
      analysis: {
        standardized_title: "Chicken 65",
        meal: "Main Dish",
        cuisine: "Indian",
        tags: ["Appetizer", "Spicy"],
        key_ingredients: ["Chicken", "Garlic", "Ginger"],
        confidence: 0.95,
        reasoning: "The recipe is for a popular South Indian dish called Chicken 65, which is often served as a main dish or appetizer. It is spicy and includes key ingredients like chicken, garlic, and ginger."
      },
      extractedData: {
        title: "Chicken 65 Recipe",
        description: "Chicken 65 is a popular South Indian Chicken appetizer made by deep frying marinated chicken with cu...",
        ingredients: ["chicken", "ginger garlic paste", "red chili powder", "coriander powder", "garam masala"]
      },
      suggestedChanges: {
        meal: { from: "Empty", to: "Main Dish" },
        cuisine: { from: "Empty", to: "Indian" },
        tags: { from: "Empty", to: ["Appetizer", "Spicy"] },
        key_ingredients: { from: "Empty", to: ["Chicken", "Garlic", "Ginger"] }
      }
    },
    {
      recipe: {
        id: "demo-3",
        url: "https://notion.so/demo-3",
        name: "Chapati Recipe (Indian Flatbread) - Swasthi's Recipes", 
        link: "https://www.indianhealthyrecipes.com/chapati/",
        current_meal: null,
        current_cuisine: null,
        current_tags: [],
        current_ingredients: []
      },
      analysis: {
        standardized_title: "Chapati (Indian Flatbread)",
        meal: "Main Dish",
        cuisine: "Indian",
        tags: ["Traditional", "Vegan"],
        key_ingredients: ["Bread"],
        confidence: 0.95,
        reasoning: "The recipe is for an Indian flatbread called Chapati, which is often served as a main dish. It is a traditional Indian recipe and is vegan as it does not contain any animal products. The key ingredient is bread, specifically whole wheat flour."
      },
      extractedData: {
        title: "Chapati Recipe (Indian Flatbread)",
        description: "Chapati Recipe to make super soft and perfect Indian flatbread every single time! The recipe uses wh...",
        ingredients: ["whole wheat flour", "water", "salt", "oil"]
      },
      suggestedChanges: {
        meal: { from: "Empty", to: "Main Dish" },
        cuisine: { from: "Empty", to: "Indian" }, 
        tags: { from: "Empty", to: ["Traditional", "Vegan"] },
        key_ingredients: { from: "Empty", to: ["Bread"] }
      }
    }
  ];

  const stats = {
    totalRecipes: demoReviewData.length,
    totalSuggestions: demoReviewData.reduce((sum, item) => {
      return sum + Object.keys(item.suggestedChanges).length;
    }, 0),
    imagesFound: 0, // No images in demo data
    avgConfidence: demoReviewData.reduce((sum, item) => sum + item.analysis.confidence, 0) / demoReviewData.length
  };

  return res.status(200).json({
    success: true,
    data: demoReviewData,
    stats: stats,
    note: "This is demo data from successful local testing"
  });
}