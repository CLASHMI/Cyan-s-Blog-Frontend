/* 与后端枚举一一对应的业务常量：判断条件与表单值都从这里取，避免各处散落的魔法数字 */
export const SystemConstant = {
  /* 用户角色 */
  Role: {
    VISITOR: 0,
    ADMIN: 1,
  },
  /* 列表排序策略 */
  SortStrategy: {
    LATEST: 0,
    HOTTEST: 1,
    TOP_RATED: 2,
    MOST_LIKED: 3,
  },
}
