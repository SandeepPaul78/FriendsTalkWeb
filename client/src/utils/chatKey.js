export const getChatKey = (user1, user2) => {
  return `chat_${[user1, user2].sort().join("_")}`;
};
