module ts.dataflow {
    export class State {
        private bit0: number;
        private bit1plus: number[];
        private maxSize: number;

        public constructor(maxSize: number) {
            this.maxSize = maxSize;
        }

        isAssigned(i: number): boolean {
            return this.getBitAt(i + 1);
        }

        setAssigned(i: number, assigned: boolean): void {
            this.setBitAt(i + 1, assigned);
        }

        isReachable(): boolean {
            return this.getBitAt(0);
        }

        setReachable(reachable: boolean): void {
            return this.setBitAt(0, reachable);
        }

        or(other: State): State {
            if (this.isReachable() === other.isReachable()) {
                // TODO: combine;
            }
            // in JS states the only possible transition is 'reachable -> unreachable'
            Debug.assert(this.isReachable() && !other.isReachable());
            return this;
        }

        getBitAt(i: number): boolean {
            if (i > this.maxSize) {
                return false;
            }
            if (i < 31) {
                return (this.bit0 & i) !== 0
            }
            else {
                return (this.bit1plus[(i / 31) | 0] >> (i % 31)) !== 0;
            }
        }

        setBitAt(i: number, v: boolean): void {
            this.resizeIfNecessary(i);
            if (i < 31) {
                if (v) {
                    this.bit0 |= i;
                }
                else {
                    this.bit0 &= ~i;
                }
            }
            else {
                var index = (i / 31) | 0;
                var value = i % 31;
                if (v) {
                    this.bit1plus[index] |= value;
                }
                else {
                    this.bit1plus[index] &= ~value;
                }
            }
        }

        private resizeIfNecessary(index: number): void {
            if (index < this.maxSize) {
                return;
            }

            var newExpectedLastIndex = (index % 31) - 1;
            if (newExpectedLastIndex < 0 || (this.bit1plus && newExpectedLastIndex <= this.bit1plus.length)) {
                return;
            }

            if (!this.bit1plus) {
                this.bit1plus = new Array<number>(newExpectedLastIndex);
            }
            else {
                for (var i = this.bit1plus.length - 1; i <= newExpectedLastIndex; ++i) {
                    this.bit1plus.push(0);
                }
            }
            this.maxSize = (newExpectedLastIndex + 1) * 31;
        }
    }
}