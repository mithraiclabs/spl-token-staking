import IDL from "../target/idl/single_sided_staking.json";

export const getMaxNumberOfRewardPools = () =>
  (
    IDL.accounts.find((acc) => acc.name === "StakePool").type.fields as {
      name: string;
      type: any;
    }[]
  ).find((_type) => _type.name === "rewardPools").type.array[1];
  