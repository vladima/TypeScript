/// <reference path="types.ts"/>
/// <reference path="core.ts"/>
/// <reference path="scanner.ts"/>
/// <reference path="parser.ts"/>
/// <reference path="binder.ts"/>

module ts {
    export interface Context {
        resolveName(name: Identifier): Symbol;
        error(n: Node, message: DiagnosticMessage, arg0?: any) : void;
        getSymbolOfNode(n: Node): Symbol;
    }

    export function checkDataFlowOfFunction(n: FunctionDeclaration, context: Context): void {
        check(n, context);
    }

    function check(n: Node, context: Context): void {
        var locals: Symbol[] = [];
        var currentState: State = reachableState();

        function walk(n: Node) {
            var symbol = context.getSymbolOfNode(n);
            if (n.locals) {
                // register locals
                for (var id in n.locals) {
                    var local = n.locals[id];
                    if (local.flags & SymbolFlags.Variable) {
                        locals.push(local);
                    }
                }
            }
        }

        walk(n);
    }

    interface State {
        variables: BitVector;
        reachability: Reachability;
    }

    function copyState(s: State) {
        return {
            variables: copyBitVector(s.variables),
            reachability: s.reachability
        };
    }

    function reachableState(): State {
        return {
            reachability: Reachability.Reachable,
            variables: createBitVector()
        };
    }

    function unreachableState(): State {
        return {
            reachability: Reachability.Unreachable,
            variables: createBitVector()
        };
    }

    interface BitVector {
        bits0: number;
        bits1plus?: number[];
    }

    function createBitVector(): BitVector {
        return { bits0: 0 };
    }

    function copyBitVector(v: BitVector): BitVector {
        if (v.bits1plus) {
            return { bits0: v.bits0, bits1plus: v.bits1plus.slice(0) };
        }
        else {
            return { bits0: v.bits0 };
        }
    }

    function bitAt(v: BitVector, i: number): boolean {
        // 5 => 2^5 === 32
        var index = (i >> 5) - 1;
        var n = index < 0 ? v.bits0 : v.bits1plus[index];
        var mask = 1 << (i & 0x1f);
        return (n & mask) !== 0;
    }

    function ensureSize(v: BitVector, i: number) {
        if (v.bits1plus && v.bits1plus.length > i) {
            return;
        }
        if (!v.bits1plus) {
            v.bits1plus = new Array<number>();
        }

        while (v.bits1plus.length <= i) {
            v.bits1plus.push(0);
        }
    }

    function setBitAt(v: BitVector, i: number, value: boolean): void {
        var index = (i >> 5) - 1;
        if (index >= 0) {
            ensureSize(v, index);
        }
        var mask = 1 << (i & 0x1f);
        if (index < 0) {
            if (value) {
                v.bits0 |= mask;
            }
            else {
                v.bits0 &= ~mask;
            }
        }
        else {
            if (value) {
                v.bits1plus[index] |= mask;
            }
            else {
                v.bits1plus[index] &= ~mask;
            }
        }
    }

    enum Reachability {
        Reachable,
        Unreachable,
    }
}