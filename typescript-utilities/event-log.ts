export type EventRecord<T> = { sequence: number; timestamp: number; payload: T };

export class EventLog<T> {
  private nextSequence = 1;
  private readonly records: EventRecord<T>[] = [];

  append(payload: T, timestamp = Date.now()): EventRecord<T> {
    const record = { sequence: this.nextSequence++, timestamp, payload };
    this.records.push(record);
    return record;
  }

  since(sequence: number): EventRecord<T>[] {
    return this.records.filter(record => record.sequence > sequence).map(record => ({ ...record }));
  }

  latest(): EventRecord<T> | undefined {
    const record = this.records[this.records.length - 1];
    return record && { ...record };
  }
}
