import { mutation } from "../_generated/server";

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    // StorageWriter.generateUploadUrl returns a string URL
    const uploadUrl = await ctx.storage.generateUploadUrl();

    // Return the upload URL (no storage id available from this API)
    return {
      uploadUrl,
      storageId: undefined,
    };
  },
});
