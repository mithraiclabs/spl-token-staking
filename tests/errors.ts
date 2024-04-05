import { parseIdlErrors, ProgramError } from "@coral-xyz/anchor";
import { assert } from "chai";
import { IDL as StakingIDL } from "../target/types/spl_token_staking";

/**
 * Entry point for legacy mechanism of parsing a transaction error, use when AnchorError is unavailable
 * (such as when sending legacy transaction types)
 * @param err
 * @param msg
 */
export const assertParsedErrorStaking = (err: any, msg: String) => {
    const programError = parseTransactionErrorStaking(err);
    if (programError != null) {
      assert.equal(programError.msg, msg);
    } else {
      console.error("IX succeeded when it should have failed.");
      assert.ok(false);
    }
  };
  
  const idlErrorsStaking = parseIdlErrors(StakingIDL);
  
  /**
   * Parses legacy anchor errors using the idl, use when AnchorError is unavailable (such as when sending
   * legacy transaction types)
   * @param error
   * @returns
   */
  export const parseTransactionErrorStaking = (error: any) => {
    const programError = ProgramError.parse(error, idlErrorsStaking);
    if (programError === null) {
      // handle Raw Transaction error. Example below
      // Error: Raw transaction TRANSACTION_ID failed ({"err":{"InstructionError":[1,{"Custom":309}]}})
      let match = error.toString().match(/Raw transaction .* failed \((.*)\)/);
      if (!match) return null;
      const errorResponse = JSON.parse(match[1]);
      const errorCode = errorResponse?.err?.InstructionError?.[1]?.Custom;
      const errorMsg = idlErrorsStaking.get(errorCode);
      if (errorMsg !== undefined) {
        return new ProgramError(errorCode, errorMsg, error.logs);
      }
    } else {
      return programError;
    }
  };
