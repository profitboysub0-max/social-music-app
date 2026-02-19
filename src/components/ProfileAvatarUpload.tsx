import React, { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { toast } from "sonner";

export function ProfileAvatarUpload({
  onUpload,
}: {
  onUpload?: (avatarId: Id<"_storage">) => void;
}) {
  const [loading, setLoading] = useState(false);
  const updateAvatar = useMutation(api.profiles.updateAvatar);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;

    setLoading(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };

      await updateAvatar({ avatarId: storageId });
      toast.success("Avatar updated!");
      onUpload?.(storageId);
    } catch (error) {
      console.error("Avatar upload failed:", error);
      toast.error("Failed to upload avatar");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  return (
    <label className="cursor-pointer text-[10px] leading-none text-blue-600 hover:text-blue-700 bg-white/90 px-1.5 py-1 rounded-md shadow-sm border border-blue-100">
      {loading ? "Uploading..." : "Change Avatar"}
      <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
    </label>
  );
}
