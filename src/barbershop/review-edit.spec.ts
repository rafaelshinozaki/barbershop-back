import { reviewEditData } from './review-edit';

describe('reviewEditData', () => {
  it('marca a resposta e tira a denúncia quando o texto muda', () => {
    expect(
      reviewEditData(
        { comment: 'ruim', reply: 'sentimos muito' },
        { rating: 2, comment: 'melhorou' },
      ),
    ).toEqual({
      rating: 2,
      comment: 'melhorou',
      reportedAt: null,
      reportReason: null,
      replyStale: true,
    });
  });

  it('não mexe na denúncia quando só a nota muda', () => {
    expect(
      reviewEditData({ comment: 'ok', reply: 'obrigado' }, { rating: 4, comment: 'ok' }),
    ).toEqual({ rating: 4, comment: 'ok' });
  });
});
